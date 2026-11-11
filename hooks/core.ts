// glanceline core: turns Claude Code's own session figures into short,
// width-aware segments, and spots what is about to go wrong.
//
// Pure functions only (no `$`, no clock, no I/O), so the tests call them
// directly against the golden file. The input is shaped like Claude Code's
// session figures; the mod builds it from `$.session.usage()` and the turns
// it watches.

export type Tone = 'ok' | 'warn' | 'bad' | 'dim' | 'accent'

export type Payload = {
  model?: { id?: string; display_name?: string }
  /** `set`: what the person chose, when the guard ran the request at `level` instead. */
  effort?: { level?: string; set?: string }
  fast_mode?: boolean
  context_window?: {
    used_percentage?: number | null
    context_window_size?: number
    total_input_tokens?: number
  }
  rate_limits?: {
    five_hour?: Window
    seven_day?: Window
    spend_limit?: Window & { used_usd?: number; limit_usd?: number; period?: string }
  }
  prompt_cache?: {
    warm?: boolean
    caching_observed?: boolean
    ttl?: string
    expires_at?: number | null
    recache_tokens_if_cold?: number | null
    /** A compaction replaced the cached conversation; the next request writes `recache_tokens_if_cold`. */
    compacted?: boolean
    /** Who compacted it, when known: Claude Code's own compaction, or keep-warm's fallback. */
    compacted_by?: 'claude' | 'g-line'
    /** Claude Code's idle compaction will summarise the conversation before this cache expires. */
    idle_compacts?: boolean
    /** The account changed since the cache was written: caches don't carry across organizations. */
    account_changed?: boolean
  }
  cost?: {
    total_cost_usd?: number
    total_duration_ms?: number
    total_lines_added?: number
    total_lines_removed?: number
  }
  pr?: { number?: number; review_state?: string; kind?: string }
  vim?: { mode?: string }
  git?: { branch?: string; dirty?: boolean } | null
}

export type Window = { used_percentage?: number; resets_at?: number }

/**
 * A part of a line: its forms widest first. `keep` marks a figure the person
 * needs at every width: the narrowest form that still says all of it. Line 2
 * moves such a segment onto another row (`fitRows`) before it narrows past
 * that form or drops it; a warning counts as one at its last form.
 */
export type Segment = { key: string; priority: number; forms: string[]; tone?: Tone; keep?: number }
export type Placed = { key: string; text: string; tone?: Tone }
export type Preset = 'minimal' | 'default' | 'full'

export type Options = {
  /** Unix seconds. */
  now: number
  preset?: Preset
  /** Custom layout: segment keys, `|` starts a new line. Overrides preset. */
  segments?: string
  icons?: 'none' | 'nerd'
  /** Minutes east of UTC for clock times; the caller's local offset. */
  utcOffsetMinutes?: number
  /**
   * Whose clock the times are on, said where it could be mistaken: `UTC+11`
   * when the person set a `tz` this machine isn't in. The widest form of an
   * absolute time carries it.
   */
  zone?: string
}

export type Alert = { id: string; text: string; tone: Tone }

export const SEP = ' · '

/** Added to a segment's priority while it warns, so it outlasts the model name when space runs out. */
export const URGENT = 50

export const PRESETS: Record<Preset, string> = {
  minimal: 'model,context,five_hour,cache',
  default: 'model,context,five_hour,seven_day,spend,cache',
  full: 'model,context,five_hour,seven_day,spend,cache|git,pr,cost,time,lines,vim',
}

const NERD: Record<string, string> = {
  model: '\u{f06a9} ', context: '\u{f035b} ', five_hour: '\u{f0150} ', seven_day: '\u{f00f0} ',
  spend: '\u{f01c1} ', cache: '\u{f0e57} ', git: '\u{e725} ', pr: '\u{e726} ', cost: '\u{f01c1} ',
  time: '\u{f051f} ', lines: '\u{f0c7e} ',
}

// ------------------------------------------------------------ formatting

/** A finite number (booleans and NaN are not), else undefined. */
export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** A short printable string, else undefined. Control characters never pass. */
export function str(value: unknown, limit = 48): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.trim()
  if (!clean || /[\u0000-\u001f\u007f-\u009f]/.test(clean)) return undefined
  return clean.slice(0, limit)
}

/**
 * 4d 10h · 8h 45m · 7m · <1m: g-line's one spelling of a span, the same in
 * every form and at every width, so `8h 45m` never shows as `8h45m` in one
 * place and `45m` in another. Its leading unit is never left out. Floored: a
 * countdown never overstates.
 */
export function duration(seconds: number): string {
  const s = Math.floor(seconds)
  if (s < 60) return '<1m'
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

export function tokens(count: number): string {
  const n = Math.floor(count)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function pct(value: number): string {
  return `${Math.round(value)}%`
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Minutes east of UTC in IANA zone `tz` at `ms`; undefined for no zone or one this runtime doesn't know. */
export function zoneOffset(tz: string | undefined, ms: number): number | undefined {
  if (!tz) return undefined
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(ms))
    const n = (type: string) => Number(parts.find(p => p.type === type)?.value)
    const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'))
    const minute = Math.floor(ms / 60_000) * 60_000
    return Math.round((local - minute) / 60_000)
  } catch {
    return undefined
  }
}

/** `UTC+11`, `UTC+5:45`, `UTC-3`: an offset in minutes, for saying which zone times are in. */
export function utcLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+'
  const a = Math.abs(offsetMinutes)
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`
}

/**
 * 16:40 today, else Thu 16:40, in the caller's zone. A time on another day
 * always names it: `08:45` at 23:50 would read as nine hours ago, or as
 * minutes away. With `zone`, the clock's owner follows: `Thu 16:40 UTC+11`.
 */
export function clock(at: number, now: number, offsetMinutes = 0, zone?: string): string {
  const local = new Date((Math.floor(at) + offsetMinutes * 60) * 1000)
  const today = new Date((Math.floor(now) + offsetMinutes * 60) * 1000)
  const hh = String(local.getUTCHours()).padStart(2, '0')
  const mm = String(local.getUTCMinutes()).padStart(2, '0')
  const sameDay = local.getUTCFullYear() === today.getUTCFullYear() && local.getUTCMonth() === today.getUTCMonth()
    && local.getUTCDate() === today.getUTCDate()
  return `${sameDay ? '' : `${DAYS[local.getUTCDay()]} `}${hh}:${mm}${zone ? ` ${zone}` : ''}`
}

export function bar(percent: number, cells = 5): string {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

function pressure(percent: number): Tone | undefined {
  if (percent >= 95) return 'bad'
  if (percent >= 80) return 'warn'
  return undefined
}

// ------------------------------------------------------------------ pace

/**
 * A projection rounded to the precision it deserves: to the hour when it is
 * more than six hours off, to the quarter hour beyond ninety minutes.
 */
export function roundEta(eta: number, now: number): number {
  const ahead = eta - now
  const step = ahead > 6 * 3600 ? 3600 : ahead > 90 * 60 ? 900 : 60
  return Math.round(eta / step) * step
}

export type Pace = { kind: 'full' } | { kind: 'hot'; eta: number } | { kind: 'ok' }

const WINDOW_SECONDS: Record<string, number> = { five_hour: 5 * 3600, seven_day: 7 * 86400 }
const MIN_ELAPSED: Record<string, number> = { five_hour: 15 * 60, seven_day: 12 * 3600 }

/**
 * Where the average rate since the window opened lands: past 100% before the
 * reset (`hot`, with the moment it would), or not (`ok`). Undefined until the
 * window has run long enough for the rate to mean something.
 */
export function pace(kind: string, window: Window | undefined, now: number): Pace | undefined {
  const used = num(window?.used_percentage)
  const resets = num(window?.resets_at)
  const length = WINDOW_SECONDS[kind]
  if (used === undefined || resets === undefined || length === undefined || resets <= now) return undefined
  if (used >= 100) return { kind: 'full' }
  const elapsed = now - (resets - length)
  if (elapsed < (MIN_ELAPSED[kind] ?? 0) || used < 1) return undefined
  const eta = now + ((100 - used) * elapsed) / used
  return eta < resets - 60 ? { kind: 'hot', eta } : { kind: 'ok' }
}

// -------------------------------------------------------------- segments

function modelSegment(p: Payload): Segment | undefined {
  const name = str(p.model?.display_name) ?? str(p.model?.id)
  if (!name) return undefined
  const level = str(p.effort?.level, 12)
  const set = str(p.effort?.set, 12)
  const fast = p.fast_mode === true
  if (level && set && set !== level) {
    const family = name.split(' ')[0] ?? name
    return { key: 'model', priority: 82, tone: 'warn',
      forms: [`${name} (${set}→${level} effort by guard${fast ? ', fast' : ''})`, `${name} ${set}→${level}`, `${family} ${set}→${level}`, `${family} ${level}`] }
  }
  const detail = [level ? `${level} effort` : '', fast ? 'fast' : ''].filter(Boolean).join(', ')
  const family = name.split(' ')[0] ?? name
  // The effort stays in every form: it is what you change most often.
  const forms = detail ? [`${name} (${detail})`, level ? `${name} ${level}` : name, level ? `${family} ${level}` : family] : [name]
  return { key: 'model', priority: 82, forms, tone: 'accent' }
}

function contextSegment(p: Payload, full: boolean): Segment | undefined {
  const w = p.context_window
  const used = num(w?.used_percentage)
  if (used === undefined || used < 0) return undefined
  const size = num(w?.context_window_size)
  const inside = num(w?.total_input_tokens)
  const left = size !== undefined && inside !== undefined && size > inside ? size - inside : undefined
  const forms = [`ctx ${pct(used)}`]
  if (left !== undefined) forms.unshift(`ctx ${pct(used)} (${tokens(left)} left)`)
  if (full) forms.unshift(`context ${bar(used)} ${pct(used)}` + (left !== undefined ? ` (${tokens(left)} left)` : ''))
  return { key: 'context', priority: 90, forms, tone: pressure(used) }
}

function windowSegment(p: Payload, kind: 'five_hour' | 'seven_day', o: Options, full: boolean): Segment | undefined {
  const window = p.rate_limits?.[kind]
  const used = num(window?.used_percentage)
  if (used === undefined || used < 0) return undefined
  const [name, short, priority] = kind === 'five_hour' ? ['5h', '5h', 85] : ['week', 'wk', 70]
  const resets = num(window?.resets_at)
  const left = resets !== undefined && resets > o.now ? resets - o.now : undefined
  const state = pace(kind, window, o.now)
  const head = full ? `${name} ${bar(used)} ${pct(used)}` : `${name} ${pct(used)}`
  if (state?.kind === 'full') {
    const after = left !== undefined ? ` (resets in ${duration(left)})` : ''
    return { key: kind, priority, tone: 'bad',
      forms: [`${name} limit reached${after}`, `${short} full` + (left !== undefined ? ` (${duration(left)})` : ''), `${short} full`] }
  }
  if (state?.kind === 'hot') {
    // `!` and `~` carry the meaning where the line is drawn dim: a warning, and
    // a projection rather than an appointment. The fill is a duration and the
    // reset a clock time, so the two can't be read as the same kind of figure.
    const fills = Math.max(60, roundEta(state.eta, o.now) - o.now)
    const back = resets !== undefined ? ` (back ${clock(resets, o.now, o.utcOffsetMinutes, o.zone)})` : ''
    const soon = state.eta - o.now < 30 * 60
    return { key: kind, priority, tone: soon ? 'bad' : 'warn',
      forms: [`${head} ! full in ~${duration(fills)}${back}`, `${short} ${pct(used)} ! full in ~${duration(fills)}`, `${short} ${pct(used)}!`] }
  }
  if (left === undefined) return { key: kind, priority, tone: pressure(used), forms: [head, `${short} ${pct(used)}`] }
  return { key: kind, priority, tone: pressure(used),
    forms: [`${head} (resets in ${duration(left)})`, `${short} ${pct(used)} (${duration(left)})`, `${short} ${pct(used)}`] }
}

function spendSegment(p: Payload): Segment | undefined {
  const spend = p.rate_limits?.spend_limit
  const used = num(spend?.used_percentage)
  if (used === undefined || used < 0) return undefined
  const forms = [`spend ${pct(used)}`]
  const usd = num(spend?.used_usd)
  const cap = num(spend?.limit_usd)
  if (usd !== undefined && cap) {
    const period = ['daily', 'weekly', 'monthly'].includes(spend?.period ?? '') ? ` ${spend?.period}` : ''
    forms.unshift(`spend $${Math.round(usd)} of $${Math.round(cap)}${period}`)
  }
  return { key: 'spend', priority: 75, forms, tone: pressure(used) }
}

function cacheSegment(p: Payload, now: number): Segment | undefined {
  const cache = p.prompt_cache
  if (!cache || cache.caching_observed !== true) return undefined
  const expires = num(cache.expires_at)
  if (cache.compacted === true) {
    const size = num(cache.recache_tokens_if_cold)
    return { key: 'cache', priority: 80,
      forms: size && size > 0 ? [`cache reset by compaction (next turn writes ${tokens(size)})`, 'cache compacted'] : ['cache compacted'] }
  }
  if (cache.warm === true && expires !== undefined && expires > now) {
    const left = expires - now
    const soon = left <= (cache.ttl === '1h' ? 300 : 60)
    return { key: 'cache', priority: 80, tone: soon ? 'warn' : 'ok',
      forms: left < 60 ? ['cache warm (<1m left)', 'cache <1m'] : [`cache warm (~${duration(left)} left)`, `cache ~${duration(left)}`] }
  }
  const recache = num(cache.recache_tokens_if_cold)
  const why = cache.account_changed === true ? ', account changed' : ''
  const forms = recache && recache > 0 ? [`cache cold (next turn rebuilds ${tokens(recache)}${why})`, 'cache cold'] : ['cache cold']
  return { key: 'cache', priority: 80, tone: 'warn', forms }
}

function costSegment(p: Payload): Segment | undefined {
  const usd = num(p.cost?.total_cost_usd)
  if (usd === undefined || usd <= 0) return undefined
  return { key: 'cost', priority: 50, tone: 'dim', forms: [`$${usd.toFixed(2)} at API prices`, `$${usd.toFixed(2)}`] }
}

function timeSegment(p: Payload): Segment | undefined {
  const ms = num(p.cost?.total_duration_ms)
  if (ms === undefined || ms < 60_000) return undefined
  return { key: 'time', priority: 45, tone: 'dim', forms: [`${duration(ms / 1000)} session`, duration(ms / 1000)] }
}

function linesSegment(p: Payload): Segment | undefined {
  const added = num(p.cost?.total_lines_added) ?? 0
  const removed = num(p.cost?.total_lines_removed) ?? 0
  if (added <= 0 && removed <= 0) return undefined
  return { key: 'lines', priority: 40, tone: 'dim', forms: [`+${added} −${removed} lines`, `+${added} −${removed}`] }
}

function gitSegment(p: Payload): Segment | undefined {
  return gitSegmentOf(p.git)
}

/** The branch, `*` when tracked files have changes. */
export function gitSegmentOf(git: Payload['git'] | undefined): Segment | undefined {
  const branch = str(git?.branch, 40)
  if (!branch) return undefined
  const mark = git?.dirty ? '*' : ''
  return { key: 'git', priority: 60, forms: [`${branch}${mark}`, `${branch.slice(0, 16)}${mark}`] }
}

function prSegment(p: Payload): Segment | undefined {
  const n = num(p.pr?.number)
  if (n === undefined) return undefined
  const label = p.pr?.kind === 'mr' ? `MR !${n}` : `PR #${n}`
  const state = str(p.pr?.review_state, 20)?.replace(/_/g, ' ')
  return { key: 'pr', priority: 55, forms: state ? [`${label} ${state}`, label] : [label] }
}

function vimSegment(p: Payload): Segment | undefined {
  const mode = str(p.vim?.mode, 12)
  return mode ? { key: 'vim', priority: 30, tone: 'dim', forms: [mode] } : undefined
}

/** The layout's segment keys, one list per line. */
export function layoutKeys(o: Options): string[][] {
  const spec = o.segments && /^[a-z_,| ]+$/.test(o.segments) ? o.segments : PRESETS[o.preset ?? 'default'] ?? PRESETS.default
  return spec.split('|').map(line => line.split(',').map(key => key.trim()).filter(Boolean)).filter(line => line.length)
}

/** Segments for each line, in order, with anything unknown left out. */
export function segments(p: Payload, o: Options): Segment[][] {
  const full = (o.preset ?? 'default') === 'full' && !o.segments
  const build: Record<string, () => Segment | undefined> = {
    model: () => modelSegment(p),
    context: () => contextSegment(p, full),
    five_hour: () => windowSegment(p, 'five_hour', o, full),
    seven_day: () => windowSegment(p, 'seven_day', o, full),
    spend: () => spendSegment(p),
    cache: () => cacheSegment(p, o.now),
    cost: () => costSegment(p),
    time: () => timeSegment(p),
    lines: () => linesSegment(p),
    git: () => gitSegment(p),
    pr: () => prSegment(p),
    vim: () => vimSegment(p),
  }
  const icons = o.icons === 'nerd'
  return layoutKeys(o).map(keys => keys.flatMap(key => {
    const segment = build[key]?.()
    if (!segment) return []
    // What is pressing outranks what is merely useful, so it survives a narrow terminal.
    if (segment.tone === 'warn' || segment.tone === 'bad') segment.priority += URGENT
    if (icons && NERD[key]) segment.forms = segment.forms.map(form => NERD[key] + form)
    return [segment]
  })).filter(line => line.length)
}

// ---------------------------------------------------------------- layout

/** Display columns. Everything glanceline prints is one column per code point. */
export function width(text: string): number {
  return [...text].length
}

export function truncate(text: string, room: number): string {
  if (room <= 0) return ''
  const chars = [...text]
  return chars.length <= room ? text : chars.slice(0, Math.max(room - 1, 0)).join('') + '…'
}

/**
 * One form per segment so the line fits `room` columns. Calm segments narrow
 * together, one tier at a time, so the line keeps one voice; a segment that
 * warns keeps its words longer: it narrows to its middle form only once the
 * calm ones are at their shortest, and to its shortest only after every calm
 * segment that doesn't fit has gone, lowest priority first. The last one left
 * is cut.
 */
export function fit(items: Segment[], room?: number): Placed[] {
  if (room === undefined) return items.map(item => ({ key: item.key, text: item.forms[0] ?? '', tone: item.tone }))
  const live = [...items]
  const loud = (item: Segment) => item.tone === 'warn' || item.tone === 'bad'
  const deepest = Math.max(1, ...live.map(item => item.forms.length))
  let calmTier = 0
  let loudTier = 0
  const forms = () => live.map(item => item.forms[Math.min(loud(item) ? loudTier : calmTier, item.forms.length - 1)] ?? '')
  const dropLowest = () => {
    let lowest = 0
    live.forEach((item, index) => { if (item.priority < (live[lowest]?.priority ?? 0)) lowest = index })
    live.splice(lowest, 1)
  }
  while (width(forms().join(SEP)) > room) {
    if (calmTier < deepest - 1) calmTier += 1
    else if (loudTier < Math.max(1, deepest - 2)) loudTier += 1
    else if (live.length > 1 && live.some(item => !loud(item))) dropLowest()
    else if (loudTier < deepest - 1) loudTier += 1
    else if (live.length > 1) dropLowest()
    else break
  }
  return live.map((item, index) => ({ key: item.key, text: truncate(forms()[index] ?? '', room), tone: item.tone }))
}

/** One extra line (a plug-in's): the widest of its forms that fits. */
export function fitExtra(forms: string[], room?: number): string {
  const clean = forms.filter(Boolean)
  if (!clean.length) return ''
  const chosen = clean.find(form => room === undefined || width(form) <= room) ?? clean[clean.length - 1] ?? ''
  return room === undefined ? chosen : truncate(chosen, room)
}

/** The narrowest form of a segment the person needs at every width (`keep`); a warning counts as one at its last form. */
export function keepOf(item: Segment): number | undefined {
  if (item.keep !== undefined) return Math.max(0, Math.min(Math.floor(item.keep), item.forms.length - 1))
  return item.tone === 'warn' || item.tone === 'bad' ? item.forms.length - 1 : undefined
}

type Choice = { item: Segment; at: number; index: number }

/** First-fit of `order` (indexes into `chosen`) into `rows` rows of `room`: each choice's row, or undefined. */
function firstFit(chosen: readonly Choice[], order: readonly number[], room: number, rows: number): number[] | undefined {
  const used = Array<number>(rows).fill(0)
  const count = Array<number>(rows).fill(0)
  const rowOf = Array<number>(chosen.length).fill(0)
  for (const i of order) {
    const w = width(chosen[i]?.item.forms[chosen[i]?.at ?? 0] ?? '')
    const row = used.findIndex((u, r) => ((count[r] ?? 0) ? u + SEP.length + w : w) <= room)
    if (row < 0) return undefined
    used[row] = (count[row] ?? 0) ? (used[row] ?? 0) + SEP.length + w : w
    count[row] = (count[row] ?? 0) + 1
    rowOf[i] = row
  }
  return rowOf
}

/**
 * The row each choice lands on in `rows` rows of `room`, or undefined when they don't fit:
 * first-fit in the line's order, else (with `reorder`, the last resort) the widest placed first,
 * which packs a phone's rows tighter, with the rows then read in the order of their first segment.
 */
function pack(chosen: readonly Choice[], room: number, rows: number, reorder = false): number[] | undefined {
  const inOrder = chosen.map((_, i) => i)
  const found = firstFit(chosen, inOrder, room, rows)
  if (found || rows < 2 || !reorder) return found
  const widest = [...inOrder].sort((a, b) => width(chosen[b]?.item.forms[chosen[b]?.at ?? 0] ?? '') - width(chosen[a]?.item.forms[chosen[a]?.at ?? 0] ?? '') || a - b)
  const packed = firstFit(chosen, widest, room, rows)
  if (!packed) return undefined
  const first = Array<number>(rows).fill(Infinity)
  packed.forEach((row, i) => { first[row] = Math.min(first[row] ?? Infinity, i) })
  const rank = [...first.keys()].sort((a, b) => (first[a] ?? 0) - (first[b] ?? 0))
  return packed.map(row => rank.indexOf(row))
}

/**
 * The forms for `rows` rows, or undefined when `strict` and the segments the
 * person needs don't fit there at their `keep` forms. What isn't needed
 * narrows, then goes, least important first; then what is needed narrows as
 * far as its `keep` form, calm segments before warnings. Past that (not
 * strict) it narrows further and, last, the least important goes.
 */
function settle(items: readonly Segment[], room: number, rows: number, strict: boolean, reorder: boolean): Choice[] | undefined {
  // Each starts at its widest form that fits a row on its own.
  const live: Choice[] = items.map((item, index) => {
    const fits = item.forms.findIndex(form => width(form) <= room)
    return { item, index, at: fits < 0 ? Math.max(0, item.forms.length - 1) : fits }
  })
  const dropped: Choice[] = []
  const loud = (c: Choice) => c.item.tone === 'warn' || c.item.tone === 'bad'
  const needed = (c: Choice) => keepOf(c.item) !== undefined
  const last = (c: Choice) => Math.max(0, c.item.forms.length - 1)
  const narrow = (group: Choice[], floor: (c: Choice) => number) => {
    let moved = false
    for (const c of group) if (c.at < floor(c)) { c.at += 1; moved = true }
    return moved
  }
  const drop = (group: Choice[]) => {
    const going = group.reduce((low, c) => (c.item.priority < low.item.priority ? c : low))
    live.splice(live.indexOf(going), 1)
    dropped.push(going)
  }
  while (live.length && !pack(live, room, rows, reorder)) {
    const extra = live.filter(c => !needed(c))
    const calm = live.filter(c => needed(c) && !loud(c))
    const louder = live.filter(c => needed(c) && loud(c))
    const kept = (c: Choice) => Math.max(c.at, keepOf(c.item) ?? last(c))
    if (narrow(extra, last)) continue
    if (extra.length) { drop(extra); continue }
    if (narrow(calm, kept) || narrow(louder, kept)) continue
    if (strict) return undefined
    if (narrow(calm, last) || narrow(louder, last)) continue
    if (live.length > 1) { drop(live); continue }
    break
  }
  // With every needed figure whole, the room left goes back to them first, most important first,
  // in their wider forms (whose clock it is, a word more); then what went comes back the same way.
  // Rows that read in the line's order stay that way.
  const inOrder = (cs: readonly Choice[]) => firstFit(cs, cs.map((_, i) => i), room, rows) !== undefined
  const ordered = inOrder(live)
  const fits = (cs: readonly Choice[]) => (ordered ? inOrder(cs) : pack(cs, room, rows, reorder) !== undefined)
  for (const c of strict ? [...live].sort((a, b) => b.item.priority - a.item.priority) : []) {
    while (c.at > 0 && width(c.item.forms[c.at - 1] ?? '') <= room) {
      c.at -= 1
      if (fits(live)) continue
      c.at += 1
      break
    }
  }
  for (const c of strict ? [...dropped].sort((a, b) => b.item.priority - a.item.priority) : []) {
    for (let at = 0; at < c.item.forms.length; at++) {
      const trial = [...live, { ...c, at }].sort((a, b) => a.index - b.index)
      if (width(c.item.forms[at] ?? '') <= room && fits(trial)) {
        live.splice(0, live.length, ...trial)
        break
      }
    }
  }
  return live
}

/**
 * Line 2 over as many rows as it needs, up to `rows`, each `room` columns:
 * one row is tried first, then two, and so on. On each try a segment the
 * person needs (`keep`) narrows only as far as its keep form, and what isn't
 * needed narrows and goes first, so a narrow screen gets another row of
 * figures rather than lose one, or the hours of a time. Only with every row
 * spent does a needed segment narrow further and, last, go. Each row keeps
 * the line's order; one segment wider than a row is cut.
 */
export function fitRows(items: readonly Segment[], room: number, rows = 1): Placed[][] {
  const most = Math.max(1, Math.floor(rows))
  // In the line's order on as few rows as hold it; only with every row spent may rows pack out of order.
  for (const reorder of [false, true]) {
    for (let n = reorder ? most : 1; n <= most; n++) {
      const plan = settle(items, room, n, true, reorder)
      if (plan) return placeRows(plan, room, n)
    }
  }
  return placeRows(settle(items, room, most, false, true) ?? [], room, most)
}

/** The rows, each in the line's order with what the person needs ahead of what they don't. */
function placeRows(plan: Choice[], room: number, rows: number): Placed[][] {
  const order = [...plan].sort((a, b) => a.index - b.index)
  const rowOf = pack(order, room, rows, true) ?? order.map(() => 0)
  const out: Choice[][] = Array.from({ length: rows }, () => [])
  order.forEach((c, i) => out[rowOf[i] ?? 0]?.push(c))
  const rank = (c: Choice) => (keepOf(c.item) === undefined ? 1 : 0)
  return out.filter(row => row.length).map(row => [...row].sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .map(c => ({ key: c.item.key, text: truncate(c.item.forms[c.at] ?? '', room), tone: c.item.tone })))
}


/** Every line, fitted. */
export function render(p: Payload, o: Options & { columns?: number }): Placed[][] {
  return segments(p, o).map(line => fit(line, o.columns))
}

export function plain(lines: Placed[][]): string[] {
  return lines.map(line => line.map(part => part.text).join(SEP))
}

// ---------------------------------------------------------------- alerts

/** What deserves a heads-up now: each with an id that is stable per event. */
export function alerts(p: Payload, o: Options): Alert[] {
  const found: Alert[] = []
  const cache = p.prompt_cache
  const expires = num(cache?.expires_at)
  if (cache?.caching_observed === true && cache.warm === true && expires !== undefined) {
    const left = expires - o.now
    if (left > 0 && left <= (cache.ttl === '1h' ? 300 : 60)) {
      const recache = num(cache.recache_tokens_if_cold)
      const stake = recache && recache > 0 ? ` (${tokens(recache)} of context at risk)` : ''
      const after = cache.idle_compacts === true
        ? 'if not, Claude Code compacts the conversation to a summary first.'
        : 'after, the next turn rebuilds it.'
      found.push({ id: `cache:${Math.floor(expires)}`, tone: 'warn',
        text: `Claude cache goes cold in ${duration(left)}${stake}. Reply before then to keep it cached; ${after}` })
    }
  }
  for (const [kind, name] of [['five_hour', '5-hour'], ['seven_day', 'weekly']] as const) {
    const window = p.rate_limits?.[kind]
    const state = pace(kind, window, o.now)
    const resets = num(window?.resets_at)
    if (state?.kind === 'hot' && resets !== undefined) {
      found.push({ id: `${kind}:${Math.floor(resets)}`, tone: 'warn',
        text: `At this pace you'll hit your ${name} limit around ${clock(roundEta(state.eta, o.now), o.now, o.utcOffsetMinutes)}. It resets ${clock(resets, o.now, o.utcOffsetMinutes, o.zone)}.` })
    }
  }
  return found
}

// ------------------------------------------------------------ model names

/** claude-opus-5-5[1m] -> Opus 5.5; anything unrecognised is returned as is. */
export function modelName(id: string): string {
  const match = /^(?:[a-z]+\.)?(?:anthropic\.)?claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:-v\d+(?::\d+)?)?(\[1m\])?$/.exec(id)
  if (!match) return id
  const [, family = '', major, minor, wide] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return `${name} ${major}${minor ? '.' + minor : ''}${wide ? ' (1M)' : ''}`
}

/**
 * How long a toast stays: about as long as it takes to read (two seconds, and
 * 50 ms a character, at least three), never past what the caller asked or nine
 * seconds. Claude Code's toast holds three lines of about 37 columns, so
 * g-line says most things in one or two.
 */
export function toastMs(text: string, asked = 4000): number {
  return Math.round(Math.min(asked, 9000, Math.max(3000, 2000 + 50 * [...text].length)))
}
