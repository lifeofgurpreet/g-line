// The two lines under the prompt. Line 1 rides at the end of Claude Code's own
// hint line and says how full things are: context, and how much of each usage
// window is gone. Line 2 sits directly under it, in colour: the model and its
// effort, then what happens next: when the prompt cache goes cold, when each
// window resets or runs out, what is running, what compacts.
//
// Pure, like core.ts: the mod hands in what it knows, the tests call it.

import { SEP, clock, duration, fit, num, pace, pct, roundEta, str, tokens } from './core'
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

/** `Opus 5.5 xhigh`: the effort stays even in the narrowest form. */
export function modelNext(p: Payload): Segment | undefined {
  const name = str(p.model?.display_name) ?? str(p.model?.id)
  if (!name) return undefined
  const level = str(p.effort?.level, 12)
  const fast = p.fast_mode === true ? ' fast' : ''
  const family = name.split(' ')[0] ?? name
  const forms = level
    ? [`${name} ${level}${fast}`, `${family} ${level}${fast}`, `${family} ${level}`]
    : [`${name}${fast}`, family]
  return { key: 'model', priority: 95, tone: 'accent', forms }
}

export function contextNow(p: Payload): Segment | undefined {
  const w = p.context_window
  const used = num(w?.used_percentage)
  if (used === undefined || used < 0) return undefined
  // The window's headroom isn't the room before auto-compact, so the line
  // shows the percentage alone; the `/g-line` pane says the rest.
  return { key: 'context', priority: 90, tone: pressure(used), forms: [`ctx ${pct(used)}`] }
}

/** `5h 64%`, with `!` once the window is on pace to run out (the line is drawn dim). */
export function windowNow(p: Payload, kind: 'five_hour' | 'seven_day', now: number): Segment | undefined {
  const window = p.rate_limits?.[kind]
  const used = num(window?.used_percentage)
  if (used === undefined || used < 0) return undefined
  const state = pace(kind, window, now)
  const name = WINDOW_NAME[kind]
  const priority = kind === 'five_hour' ? 85 : 70
  if (state?.kind === 'full') return { key: kind, priority, tone: 'bad', forms: [`${name} full`] }
  if (state?.kind === 'hot') return { key: kind, priority, tone: 'warn', forms: [`${name} ${pct(used)}!`] }
  return { key: kind, priority, tone: pressure(used), forms: [`${name} ${pct(used)}`] }
}

export function spendNow(p: Payload): Segment | undefined {
  const used = num(p.rate_limits?.spend_limit?.used_percentage)
  if (used === undefined || used < 0) return undefined
  return { key: 'spend', priority: 75, tone: pressure(used), forms: [`spend ${pct(used)}`] }
}

/** Line 1's segments, in order. */
export function lineNow(p: Payload, o: Options): Segment[] {
  return [contextNow(p), windowNow(p, 'five_hour', o.now), windowNow(p, 'seven_day', o.now), spendNow(p)]
    .filter((s): s is Segment => s !== undefined).map(urgent)
}

// ------------------------------------------------------------------ line 2

/**
 * `cache 58m`, green while warm, amber in its last minutes, then `cache cold`;
 * after a compaction, the summary the next turn writes instead.
 */
export function cacheNext(p: Payload, now: number): Segment | undefined {
  const cache = p.prompt_cache
  if (!cache || cache.caching_observed !== true) return undefined
  const expires = num(cache.expires_at)
  if (cache.compacted === true) {
    const size = num(cache.recache_tokens_if_cold)
    return { key: 'cache', priority: 90,
      forms: size && size > 0 ? [`compacted, next turn caches ${tokens(size)}`, 'cache compacted'] : ['cache compacted'] }
  }
  if (cache.warm === true && expires !== undefined && expires > now) {
    const left = expires - now
    const soon = left <= (cache.ttl === '1h' ? 300 : 60)
    // `~`: the mod knows when the last request ran and the cache's lifetime,
    // not the provider's own expiry.
    const about = left < 60 ? '<1m' : `~${duration(left, true)}`
    return { key: 'cache', priority: 90, tone: soon ? 'warn' : 'ok',
      forms: [`cache warm ${left < 60 ? '<1m' : `~${duration(left)}`}`, `cache ${about}`] }
  }
  const recache = num(cache.recache_tokens_if_cold)
  return { key: 'cache', priority: 90, tone: 'warn',
    forms: recache && recache > 0 ? [`cache cold, next turn rebuilds ${tokens(recache)}`, 'cache cold'] : ['cache cold'] }
}

/** When a window resets, or (on pace to run out) roughly when it runs out. */
export function windowNext(p: Payload, kind: 'five_hour' | 'seven_day', o: Options): Segment | undefined {
  const window = p.rate_limits?.[kind]
  const used = num(window?.used_percentage)
  const resets = num(window?.resets_at)
  if (used === undefined || used < 0 || resets === undefined || resets <= o.now) return undefined
  const name = WINDOW_NAME[kind]
  const state = pace(kind, window, o.now)
  const at = (t: number) => clock(t, o.now, o.utcOffsetMinutes)
  const left = resets - o.now
  // A healthy window's reset is the first thing to go when room is short.
  const priority = kind === 'five_hour' ? 40 : 35
  if (state?.kind === 'full') {
    return { key: `${kind}_next`, priority, tone: 'bad', forms: [`${name} back in ${duration(left)}`, `${name} back ${duration(left, true)}`] }
  }
  if (state?.kind === 'hot') {
    const tone: Tone = state.eta - o.now < 30 * 60 ? 'bad' : 'warn'
    return { key: `${kind}_next`, priority, tone,
      forms: [`${name} out ~${at(roundEta(state.eta, o.now))}, resets ${at(resets)}`, `${name} out ~${at(roundEta(state.eta, o.now))}`] }
  }
  return { key: `${kind}_next`, priority, forms: [`${name} resets in ${duration(left)}`, `${name} resets ${duration(left, true)}`] }
}

export function spendNext(p: Payload): Segment | undefined {
  const spend = p.rate_limits?.spend_limit
  const usd = num(spend?.used_usd)
  const cap = num(spend?.limit_usd)
  if (usd === undefined || !cap) return undefined
  const period = ['daily', 'weekly', 'monthly'].includes(spend?.period ?? '') ? ` ${spend?.period}` : ''
  return { key: 'spend_next', priority: 75, forms: [`$${Math.round(usd)} of $${Math.round(cap)}${period}`, `$${Math.round(usd)}/$${Math.round(cap)}`] }
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

export type Deck = { now: Placed[]; next: Placed[] }

/**
 * Both lines, each fitted to its own room. What line 1 has no room for moves
 * down to line 2 instead of vanishing; line 2 drops its least important
 * segments only when both lines are full.
 */
export function deck(p: Payload, o: Options, rooms: { now?: number; next?: number }, extras: Segment[] = []): Deck {
  const now = lineNow(p, o)
  const placed = rooms.now !== undefined && rooms.now < 4 ? [] : fit(now, rooms.now)
  const kept = new Set(placed.map(part => part.key))
  const moved = now.filter(segment => !kept.has(segment.key))
  const next = [...lineNext(p, o, extras), ...moved]
  return { now: placed, next: rooms.next !== undefined && rooms.next < 4 ? [] : fit(next, rooms.next) }
}
