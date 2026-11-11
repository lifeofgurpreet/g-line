// The two lines under the prompt. Line 1 rides at the end of Claude Code's own
// hint line and says how full things are: context, and how much of each usage
// window is gone. Line 2 sits directly under it, in colour: the model and its
// effort, then what happens next: when the prompt cache goes cold, when each
// window resets or runs out, what is running, what compacts.
//
// Pure, like core.ts: the mod hands in what it knows, the tests call it.

import { clock, duration, fit, fitRows, num, pace, pct, roundEta, str, tokens } from './core'
import type { Options, Payload, Placed, Segment, Tone } from './core'

/** Added to a segment's priority while it warns, as core's segments do. */
const URGENT = 50

function urgent(segment: Segment): Segment {
  return segment.tone === 'warn' || segment.tone === 'bad' ? { ...segment, priority: segment.priority + URGENT } : segment
}

function pressure(percent: number): Tone | undefined {
  if (percent >= 95) return 'bad'
  if (percent >= 80) return 'warn'
  return undefined
}

const WINDOW_NAME = { five_hour: '5h', seven_day: 'wk' } as const

// ------------------------------------------------------------------ line 1

/** `Opus 5.5 xhigh`, or `Opus 5.5 xhigh→medium` where the guard ran it lower: the effort stays even in the narrowest form. */
export function modelNext(p: Payload): Segment | undefined {
  const name = str(p.model?.display_name) ?? str(p.model?.id)
  if (!name) return undefined
  const level = str(p.effort?.level, 12)
  const set = str(p.effort?.set, 12)
  const fast = p.fast_mode === true ? ' fast' : ''
  const family = name.split(' ')[0] ?? name
  if (level && set && set !== level) {
    return { key: 'model', priority: 95, tone: 'warn', keep: 3,
      forms: [`${name} ${set}→${level} by guard${fast}`, `${name} ${set}→${level}${fast}`, `${family} ${set}→${level}`, `${family} ${level}`] }
  }
  const forms = level
    ? [`${name} ${level}${fast}`, `${family} ${level}${fast}`, `${family} ${level}`]
    : [`${name}${fast}`, family]
  return { key: 'model', priority: 95, tone: 'accent', keep: forms.length - 1, forms }
}

export function contextNow(p: Payload): Segment | undefined {
  const w = p.context_window
  const used = num(w?.used_percentage)
  if (used === undefined || used < 0) return undefined
  // The window's headroom isn't the room before auto-compact, so the line
  // shows the percentage alone; the `/g-line` pane says the rest.
  return { key: 'context', priority: 90, tone: pressure(used), keep: 0, forms: [`ctx ${pct(used)}`] }
}

/** `5h 64%`, with `!` once the window is on pace to run out (the line is drawn dim). */
export function windowNow(p: Payload, kind: 'five_hour' | 'seven_day', now: number): Segment | undefined {
  const window = p.rate_limits?.[kind]
  const used = num(window?.used_percentage)
  if (used === undefined || used < 0) return undefined
  const state = pace(kind, window, now)
  const name = WINDOW_NAME[kind]
  const priority = kind === 'five_hour' ? 85 : 80
  if (state?.kind === 'full') return { key: kind, priority, tone: 'bad', keep: 0, forms: [`${name} full`] }
  if (state?.kind === 'hot') return { key: kind, priority, tone: 'warn', keep: 0, forms: [`${name} ${pct(used)}!`] }
  return { key: kind, priority, tone: pressure(used), keep: 0, forms: [`${name} ${pct(used)}`] }
}

export function spendNow(p: Payload): Segment | undefined {
  const used = num(p.rate_limits?.spend_limit?.used_percentage)
  if (used === undefined || used < 0) return undefined
  return { key: 'spend', priority: 75, tone: pressure(used), keep: 0, forms: [`spend ${pct(used)}`] }
}

/** Line 1's segments, in order. */
export function lineNow(p: Payload, o: Options): Segment[] {
  return [contextNow(p), windowNow(p, 'five_hour', o.now), windowNow(p, 'seven_day', o.now), spendNow(p)]
    .filter((s): s is Segment => s !== undefined).map(urgent)
}

// ------------------------------------------------------------------ line 2

/**
 * `cache warm ~58m (57k)`, green while warm, amber in its last minutes, then `cache cold`;
 * after a compaction, the summary the next turn writes instead.
 */
export function cacheNext(p: Payload, now: number): Segment | undefined {
  const cache = p.prompt_cache
  if (!cache || cache.caching_observed !== true) return undefined
  const expires = num(cache.expires_at)
  if (cache.compacted === true) {
    const size = num(cache.recache_tokens_if_cold)
    const by = cache.compacted_by === 'claude' ? ' by Claude Code' : cache.compacted_by === 'g-line' ? ' by g-line' : ''
    const plain = size && size > 0 ? [`compacted, next turn caches ${tokens(size)}`, 'cache compacted'] : ['cache compacted']
    const forms = [...(by ? [size && size > 0 ? `compacted${by}, next turn caches ${tokens(size)}` : `compacted${by}`] : []), ...plain]
    return { key: 'cache', priority: 90, keep: forms.length - 1, forms }
  }
  if (cache.warm === true && expires !== undefined && expires > now) {
    const left = expires - now
    const soon = left <= (cache.ttl === '1h' ? 300 : 60)
    // `~`: the mod knows when the last request ran and the cache's lifetime,
    // not the provider's own expiry.
    const about = left < 60 ? '<1m' : `~${duration(left)}`
    const warm = `cache warm ${left < 60 ? '<1m' : `~${duration(left)}`}`
    // Each request restarts the clock, so a busy session always reads ~59m:
    // the size is what a lapse would cost, kept until the last resort.
    const size = num(cache.recache_tokens_if_cold)
    return { key: 'cache', priority: 90, tone: soon ? 'warn' : 'ok',
      ...(size && size > 0
        ? { keep: 2, forms: [`${warm} (${tokens(size)})`, `cache ${about} (${tokens(size)})`, `cache ${about} ${tokens(size)}`, `cache ${about}`] }
        : { keep: 1, forms: [warm, `cache ${about}`] }) }
  }
  const recache = num(cache.recache_tokens_if_cold)
  if (cache.account_changed === true) {
    return { key: 'cache', priority: 90, tone: 'warn',
      ...(recache && recache > 0
        ? { keep: 2, forms: [`cache cold (account changed), next turn rebuilds ${tokens(recache)}`, `cache cold (account changed) ${tokens(recache)}`, `cache cold ${tokens(recache)}`, 'cache cold'] }
        : { keep: 1, forms: ['cache cold (account changed)', 'cache cold'] }) }
  }
  // The size stays as long as there's room for it, like the warm cache's: it's what the next turn pays.
  return { key: 'cache', priority: 90, tone: 'warn',
    ...(recache && recache > 0
      ? { keep: 2, forms: [`cache cold, next turn rebuilds ${tokens(recache)}`, `cache cold, rebuilds ${tokens(recache)}`, `cache cold ${tokens(recache)}`, 'cache cold'] }
      : { keep: 0, forms: ['cache cold'] }) }
}

/**
 * When a window resets, or (on pace to run out) roughly when it runs out and
 * when it's back: how long, and the clock time in the person's zone. Every
 * form keeps the span whole (`8h 45m`, never `45m`); the clock goes only in
 * the last-resort forms, which a narrow screen reaches after another row.
 * `lead` replaces the window's name: line 2 puts the gauge there when line 1
 * had no room for it (`5h 3% resets in 8h 45m (10:40)`).
 */
export function windowNext(p: Payload, kind: 'five_hour' | 'seven_day', o: Options, lead: string = WINDOW_NAME[kind]): Segment | undefined {
  const window = p.rate_limits?.[kind]
  const used = num(window?.used_percentage)
  const resets = num(window?.resets_at)
  if (used === undefined || used < 0 || resets === undefined || resets <= o.now) return undefined
  const state = pace(kind, window, o.now)
  const at = clock(resets, o.now, o.utcOffsetMinutes)
  const owned = o.zone ? clock(resets, o.now, o.utcOffsetMinutes, o.zone) : undefined
  const left = duration(resets - o.now)
  // Under the gauges: the last of the needed figures to go, and only with every row spent.
  const priority = kind === 'five_hour' ? 74 : 72
  // Widest first: whose clock it is (where that could be mistaken), the clock, a word
  // shorter; then, as the last resort, the span alone. The span is in every form.
  const forms = (word: string, short: string, said: (w: string, time: string) => string, plain: (w: string) => string) => ({
    forms: [...(owned ? [said(word, owned)] : []), said(word, at), said(short, at), plain(word), plain(short)],
    keep: owned ? 2 : 1,
  })
  let built: { forms: string[]; keep: number }
  let tone: Tone | undefined
  if (state?.kind === 'full') {
    tone = 'bad'
    built = forms('back in', 'back', (w, t) => `${w} ${left} (${t})`, w => `${w} ${left}`)
  } else if (state?.kind === 'hot') {
    tone = state.eta - o.now < 30 * 60 ? 'bad' : 'warn'
    // How long until it fills, not a clock time: "out ~00:35" at 00:20 read as
    // 35 minutes left, beside a reset two hours away. `back` is the full
    // window's own word for the reset.
    const fills = duration(Math.max(60, roundEta(state.eta, o.now) - o.now))
    built = forms('full in', 'full', (w, t) => `${w} ~${fills}, back ${t}`, w => `${w} ~${fills}`)
  } else {
    built = forms('resets in', 'resets', (w, t) => `${w} ${left} (${t})`, w => `${w} ${left}`)
  }
  // A full window's gauge reads `5h full`: a comma keeps what follows one phrase.
  const join = state?.kind === 'full' && lead !== WINDOW_NAME[kind] ? ', ' : ' '
  return { key: `${kind}_next`, priority, tone, keep: built.keep, forms: built.forms.map(form => `${lead}${join}${form}`) }
}

export function spendNext(p: Payload): Segment | undefined {
  const spend = p.rate_limits?.spend_limit
  const usd = num(spend?.used_usd)
  const cap = num(spend?.limit_usd)
  if (usd === undefined || !cap) return undefined
  const period = ['daily', 'weekly', 'monthly'].includes(spend?.period ?? '') ? ` ${spend?.period}` : ''
  return { key: 'spend_next', priority: 75, keep: 1, forms: [`$${Math.round(usd)} of $${Math.round(cap)}${period}`, `$${Math.round(usd)}/$${Math.round(cap)}`] }
}

/** Line 2's segments: the model and effort, the cache, the windows' timing, then what the mod adds (agents, compaction, today, branch, account). */
export function lineNext(p: Payload, o: Options, extras: Segment[] = []): Segment[] {
  return [modelNext(p), cacheNext(p, o.now), windowNext(p, 'five_hour', o), windowNext(p, 'seven_day', o), spendNext(p), ...extras]
    .filter((s): s is Segment => s !== undefined).map(urgent)
}

// ---------------------------------------------------------------- the deck

/** Columns line 2 has: it starts at the row's two-column indent, and the engine keeps three columns free at its end. */
export function nextRoom(columns: number | undefined): number | undefined {
  return columns === undefined ? undefined : columns - 5
}

/**
 * Rows line 2 may take at this width: it uses one where one holds every
 * figure the person needs, and on a narrow screen up to three (four on a
 * phone held upright, under 50 columns) so none of them loses a part or goes.
 * Pulse's row gives way to them.
 */
export function nextRows(columns: number | undefined): number {
  return columns !== undefined && columns < 50 ? 4 : 3
}

export type Deck = { now: Placed[]; next: Placed[]; more: Placed[][] }

/**
 * A gauge line 1 had no room for joins its window's timing on line 2 as one
 * figure (`wk 88%! full in ~18h 16m, back Thu 21:00`), so the window is named
 * once; the gauge alone is its last resort.
 */
function joinMoved(p: Payload, o: Options, next: Segment[], moved: Segment[]): Segment[] {
  const out = [...next]
  const rest: Segment[] = []
  const loud = (t?: Tone) => t === 'warn' || t === 'bad'
  for (const gauge of moved) {
    const kind = gauge.key === 'five_hour' || gauge.key === 'seven_day' ? gauge.key : undefined
    const at = kind ? out.findIndex(segment => segment.key === `${kind}_next`) : -1
    const timing = kind && at >= 0 ? windowNext(p, kind, o, gauge.forms[0] ?? '') : undefined
    if (!timing) {
      rest.push(gauge)
      continue
    }
    const tone: Tone | undefined = gauge.tone === 'bad' || timing.tone === 'bad' ? 'bad' : loud(gauge.tone) || loud(timing.tone) ? 'warn' : undefined
    out[at] = urgent({ key: gauge.key, priority: gauge.priority, tone, keep: timing.keep, forms: [...timing.forms, ...gauge.forms] })
  }
  // A gauge with no timing to join (the context) follows the model, ahead of the line's extras.
  const model = out.findIndex(segment => segment.key === 'model')
  return [...out.slice(0, model + 1), ...rest, ...out.slice(model + 1)]
}

/**
 * Both lines, each fitted to its own room. What line 1 has no room for moves
 * down to line 2 instead of vanishing. Line 2 takes up to `rooms.rows` rows
 * (`more` holds those past its first): a figure the person needs goes onto
 * another row before it loses a part or goes, and what isn't needed goes
 * first, least important first.
 */
export function deck(p: Payload, o: Options, rooms: { now?: number; next?: number; rows?: number }, extras: Segment[] = []): Deck {
  const now = lineNow(p, o)
  const placed = rooms.now !== undefined && rooms.now < 4 ? [] : fit(now, rooms.now)
  const kept = new Set(placed.map(part => part.key))
  const moved = now.filter(segment => !kept.has(segment.key))
  const next = joinMoved(p, o, lineNext(p, o, extras), moved)
  if (rooms.next === undefined) return { now: placed, next: once(fit(next), o.zone), more: [] }
  if (rooms.next < 4) return { now: placed, next: [], more: [] }
  const [first = [], ...more] = fitRows(next, rooms.next, rooms.rows ?? 1)
  const rows = [first, ...more].map(row => row.map(part => ({ ...part })))
  once(rows.flat(), o.zone)
  return { now: placed, next: rows[0] ?? [], more: rows.slice(1) }
}

/** Whose clock it is, said once: the first time on line 2 keeps ` UTC+11`, the rest drop it. */
function once(parts: Placed[], zone?: string): Placed[] {
  if (!zone) return parts
  const tag = ` ${zone}`
  let said = false
  for (const part of parts) {
    if (!part.text.includes(tag)) continue
    if (said) part.text = part.text.split(tag).join('')
    said = true
  }
  return parts
}
