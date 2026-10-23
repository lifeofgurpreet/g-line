// The guard: rules the person writes in config.json that act when a usage
// window runs low. Off by default: with no rules it does nothing at all.
//
// A rule names how much of a window is left (`left`: percent) and one thing to
// do then: run the main conversation at a lower effort, run new subagents on a
// cheaper model, or stop new prompts. It can be limited to some accounts (the
// `account_command` reading) and to hours of the week in a time zone. Keep-warm
// re-reads an idle conversation's prompt cache before it lapses.
//
// Pure: the mod hands in the figures, these decide. Missing figures decide
// nothing: no reading, no account, an unknown time zone, and the rule waits.

/** How far above its threshold a window must climb before an active rule lets go: readings are coarse. */
export const CLEAR_MARGIN = 2

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export type WindowName = '5h' | 'week'

export type Hours = { from: number; to: number; days: number[] }

export type Rule = {
  id: string
  /** Percent of the window left at or below which the rule applies. */
  left: number
  window: WindowName
  effort?: Effort
  /** A model alias or id for new subagents (`sonnet`, `haiku`). */
  agents?: string
  stop?: boolean
  /** A stop that also ends a running main-loop turn at its next step, once the rule starts mid-turn. */
  endTurn?: boolean
  /** The rule waits while the window resets within this many seconds. */
  unlessResetWithin?: number
  /** Lower-case parts of the account reading, any of which picks the account. */
  accounts?: string[]
  /** Lower-case parts of the account reading, any of which leaves the account out. */
  exceptAccounts?: string[]
  /** Names of account groups (`guard.groups`, or `other` for an account in none) the rule applies to. */
  groups?: string[]
  hours?: Hours
  tz?: string
  /** A paced weekly allowance in place of a cliff: the rule's steps come with how far ahead of pace the week is. */
  pace?: Pace
  /** The rule as written, for toasts. */
  text: string
}

/**
 * A paced weekly allowance. The week runs from seven days before the engine's reported
 * weekly reset to the reset. `reserve` percent of it is kept back; `burst` points are
 * free from the first minute; the rest opens up as the week goes by, office hours
 * counting `officeWeight` times an ordinary hour. Ahead of that allowance by `tiers[0]`
 * points (the used figure plus `buffer`), the conversation's effort is capped; by
 * `tiers[1]`, new subagents run on a cheaper model; by `tiers[2]`, new prompts stop.
 */
export type Pace = {
  reserve: number; burst: number; office?: Hours; officeWeight: number; tz?: string
  buffer: number; tiers: [number, number, number]; effort: Effort; agents: string
  /** The window paced: the week (the default) or the 5-hour window. */
  window?: WindowName
}

const FIVE_HOURS_MS = 5 * 3_600_000
const spanOf = (p: Pace) => (p.window === '5h' ? FIVE_HOURS_MS : WEEK_MS)
/** The paced window in words. */
const paceName = (w: WindowName | undefined) => (w === '5h' ? '5-hour window' : 'week')

export type KeepWarm = {
  /** `last`: only the session the person last typed in, per account; `all`: every idle session. */
  sessions: 'last' | 'all'
  /** Seconds idle before a re-read. */
  after: number
  /** Re-reads per idle stretch. */
  max: number
  /** Smallest cached conversation worth keeping, in tokens. */
  minContext: number
  /** No re-read once the 5-hour window has less than this percent left. */
  minLeft: number
  /** Re-reads per hour across every session on the machine. */
  perHour: number
}

/** After a turn stops on a usage limit: one prompt after the reset, plus up to `jitter` seconds. */
export type Resume = { text: string; jitter: number }

/**
 * A named bucket of accounts (`guard.groups`): an account belongs to the first
 * group, in the order written, whose words its account line contains, and to
 * `other` when it's in none. Rules name groups to apply to them all at once.
 */
export type Group = { name: string; words: string[]; keepFor: string }

/** The group of accounts in no group the person wrote. */
export const OTHER_GROUP = 'other'

export type GuardConfig = {
  on: boolean; rules: Rule[]; groups?: Group[]; keepWarm?: KeepWarm; resume?: Resume
  /** Hold a typed prompt the guard refuses and send it when the guard lets it through. */
  queue?: boolean
  /** Near the weekly reset, say once that what's left is there to use: within `within` seconds, with `left` percent or more left. */
  drain?: { within: number; left: number }
  errors: string[]
}

export const NO_GUARD: GuardConfig = { on: true, rules: [], errors: [] }

export const KEEP_WARM_DEFAULTS: KeepWarm = { sessions: 'last', after: 45 * 60, max: 2, minContext: 50_000, minLeft: 20, perHour: 6 }

/** `45m`, `1h`, `90s`, `1h30m`, `3d`, or a number of minutes, in seconds. */
export function seconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value * 60
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  if (!/^(\d+(\.\d+)?\s*[dhms]\s*)+$/.test(text)) return undefined
  let total = 0
  for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/g)) total += Number(n) * (unit === 'd' ? 86_400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1)
  return Number.isFinite(total) ? total : undefined
}

/** `50k`, `1.2m`, `50000`, in tokens. */
export function tokenCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value !== 'string') return undefined
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec(value.trim())
  if (!m) return undefined
  const n = Number(m[1]) * (m[2]?.toLowerCase() === 'k' ? 1000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1)
  return Number.isFinite(n) ? n : undefined
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** `09:00-17:00 mon-fri`, `22:00-06:00`, `9-17 sat,sun`: minutes of the day and the days (0 = Sunday). */
export function parseHours(value: unknown): Hours | undefined {
  if (typeof value !== 'string') return undefined
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(.*)$/.exec(value.toLowerCase())
  if (!m) return undefined
  const from = Number(m[1]) * 60 + Number(m[2] ?? 0)
  const to = Number(m[3]) * 60 + Number(m[4] ?? 0)
  const minutesOk = (m[2] === undefined || Number(m[2]) < 60) && (m[4] === undefined || Number(m[4]) < 60)
  if (!minutesOk || from > 24 * 60 || to > 24 * 60 || from === to) return undefined
  const rest = (m[5] ?? '').trim()
  if (!rest || rest === 'daily' || rest === 'every day') return { from, to, days: [0, 1, 2, 3, 4, 5, 6] }
  const days = new Set<number>()
  for (const part of rest.split(/[\s,]+/).filter(Boolean)) {
    const range = /^([a-z]{3})[a-z]*(?:-([a-z]{3})[a-z]*)?$/.exec(part)
    const a = range ? DAYS.indexOf(range[1] ?? '') : -1
    const b = range?.[2] ? DAYS.indexOf(range[2]) : a
    if (a < 0 || b < 0) return undefined
    for (let d = a; ; d = (d + 1) % 7) {
      days.add(d)
      if (d === b) break
    }
  }
  return { from, to, days: [...days].sort() }
}

/** The weekday (0 = Sunday) and minute of the day at `nowMs` in `tz` (the machine's zone when absent); nothing for an unknown zone. */
export function localTime(nowMs: number, tz?: string, offsetMinutes?: number): { day: number; minute: number } | undefined {
  if (!tz) {
    const at = new Date(nowMs + (offsetMinutes ?? 0) * 60_000)
    return { day: at.getUTCDay(), minute: at.getUTCHours() * 60 + at.getUTCMinutes() }
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(nowMs))
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
    const day = DAYS.indexOf(get('weekday').toLowerCase().slice(0, 3))
    const minute = (Number(get('hour')) % 24) * 60 + Number(get('minute'))
    return day < 0 || !Number.isFinite(minute) ? undefined : { day, minute }
  } catch {
    return undefined
  }
}

/** Whether `at` falls in `hours`. A range past midnight counts from its starting day. */
export function inHours(hours: Hours, at: { day: number; minute: number }): boolean {
  if (hours.from < hours.to) return hours.days.includes(at.day) && at.minute >= hours.from && at.minute < hours.to
  if (at.minute >= hours.from) return hours.days.includes(at.day)
  return at.minute < hours.to && hours.days.includes((at.day + 6) % 7)
}

const word = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '')

/** The `guard` block of config.json. Anything malformed is left out and said in `errors`. */
export function parseGuard(raw: unknown): GuardConfig {
  if (raw === false) return { ...NO_GUARD, on: false }
  if (!raw || typeof raw !== 'object') return NO_GUARD
  const r = raw as Record<string, unknown>
  const errors: string[] = []
  const rules: Rule[] = []
  const groups = parseGroups(r.groups, errors)
  const list = Array.isArray(r.rules) ? r.rules : []
  list.forEach((entry, index) => {
    const text = JSON.stringify(entry)
    if (!entry || typeof entry !== 'object') {
      errors.push(`rule ${index + 1} is not an object`)
      return
    }
    const e = entry as Record<string, unknown>
    const n = index + 1
    // A rule with anything malformed is left out whole: a half-read rule would apply more widely than written.
    const bad = (why: string) => {
      errors.push(`rule ${n}: ${why}`)
    }
    const paced = e.pace !== undefined
    const left = paced ? 0 : typeof e.left === 'number' ? e.left : Number.NaN
    if (!paced && !(left > 0 && left <= 100)) return bad('"left" must be a percent from 1 to 100')
    if (e.window !== undefined && !['5h', 'week'].includes(word(e.window))) return bad('"window" is "5h" or "week"')
    if (paced && (e.left !== undefined || e.effort !== undefined || e.agents !== undefined || e.stop !== undefined)) {
      return bad('a "pace" rule sets its own steps: leave out "left", "effort", "agents" and "stop"')
    }
    // A pace rule paces the week unless it names the 5-hour window.
    const window: WindowName = paced ? (word(e.window) === '5h' ? '5h' : 'week') : word(e.window) === 'week' ? 'week' : '5h'
    const rule: Rule = { id: `r${index}`, left, window, text }
    if (paced) {
      const pace = parsePace(e.pace, typeof e.tz === 'string' ? e.tz.trim() : undefined, n, errors)
      if (!pace) return
      rule.pace = window === '5h' ? { ...pace, window } : pace
      rule.stop = true
    }
    if (e.effort !== undefined) {
      if ((EFFORTS as readonly string[]).includes(word(e.effort))) rule.effort = word(e.effort) as Effort
      else return bad(`"effort" is one of ${EFFORTS.join(', ')}`)
    }
    if (e.agents !== undefined) {
      if (typeof e.agents === 'string' && /^[a-z0-9._[\]-]{2,80}$/i.test(e.agents.trim())) rule.agents = e.agents.trim()
      else return bad('"agents" names a model, such as "sonnet"')
    }
    if (e.stop === true) rule.stop = true
    if (e.end_turn !== undefined && typeof e.end_turn !== 'boolean') return bad('"end_turn" is true or false')
    if (e.end_turn === true) {
      if (rule.stop) rule.endTurn = true
      else return bad('"end_turn" goes with "stop": true')
    }
    if (!rule.effort && !rule.agents && !rule.stop) return bad('it does nothing: give it "effort", "agents" or "stop": true')
    if (e.unless_reset_within !== undefined) {
      const s = seconds(e.unless_reset_within)
      if (s === undefined) return bad('"unless_reset_within" is a time such as "1h"')
      rule.unlessResetWithin = s
    }
    if (e.accounts !== undefined) {
      const accounts = (Array.isArray(e.accounts) ? e.accounts : [e.accounts]).map(word).filter(Boolean)
      if (!accounts.length) return bad('"accounts" lists parts of the account line, such as "team@"')
      rule.accounts = accounts
    }
    if (e.except_accounts !== undefined) {
      const except = (Array.isArray(e.except_accounts) ? e.except_accounts : [e.except_accounts]).map(word).filter(Boolean)
      if (!except.length) return bad('"except_accounts" lists parts of the account line, such as "me@"')
      rule.exceptAccounts = except
    }
    if (e.groups !== undefined || e.group !== undefined) {
      const named = (Array.isArray(e.groups) ? e.groups : [e.groups ?? e.group]).map(word).filter(Boolean)
      const unknown = named.filter(g => g !== OTHER_GROUP && !groups.some(x => x.name === g))
      if (!named.length) return bad('"groups" names groups from "guard.groups", such as "team"')
      if (unknown.length) return bad(`no group named ${unknown.map(g => `"${g}"`).join(', ')} in "guard.groups"`)
      rule.groups = named
    }
    if (e.hours !== undefined) {
      const hours = parseHours(e.hours)
      if (!hours) return bad('"hours" is like "09:00-17:00 mon-fri"')
      rule.hours = hours
    }
    if (e.tz !== undefined) {
      if (typeof e.tz !== 'string' || !e.tz.trim() || !localTime(0, e.tz.trim())) return bad(`unknown time zone "${String(e.tz)}"`)
      rule.tz = e.tz.trim()
    }
    rules.push(rule)
  })
  let keepWarm: KeepWarm | undefined
  if (r.keep_warm === true) keepWarm = KEEP_WARM_DEFAULTS
  else if (r.keep_warm && typeof r.keep_warm === 'object') {
    const k = r.keep_warm as Record<string, unknown>
    const after = seconds(k.after)
    const max = typeof k.max === 'number' && k.max >= 0 ? Math.floor(k.max) : undefined
    const minContext = tokenCount(k.min_context)
    const minLeft = typeof k.min_left === 'number' && k.min_left >= 0 ? k.min_left : undefined
    const perHour = typeof k.per_hour === 'number' && k.per_hour >= 0 ? Math.floor(k.per_hour) : undefined
    keepWarm = {
      sessions: k.sessions === 'all' ? 'all' : 'last',
      // Under ten minutes would ping a busy session; past 55 the cache may already be gone.
      after: after !== undefined ? Math.min(55 * 60, Math.max(10 * 60, after)) : KEEP_WARM_DEFAULTS.after,
      max: Math.min(6, max ?? KEEP_WARM_DEFAULTS.max),
      minContext: minContext ?? KEEP_WARM_DEFAULTS.minContext,
      minLeft: minLeft ?? KEEP_WARM_DEFAULTS.minLeft,
      perHour: perHour ?? KEEP_WARM_DEFAULTS.perHour,
    }
  }
  let resume: Resume | undefined
  if (r.resume === true) resume = { text: 'continue', jitter: 300 }
  else if (r.resume && typeof r.resume === 'object') {
    const o = r.resume as Record<string, unknown>
    const text = typeof o.text === 'string' && o.text.trim() ? o.text.trim().slice(0, 500) : 'continue'
    resume = { text, jitter: Math.min(1800, seconds(o.jitter) ?? 300) }
  }
  let drain: GuardConfig['drain']
  if (r.drain === true) drain = { within: 48 * 3600, left: 20 }
  else if (r.drain && typeof r.drain === 'object') {
    const o = r.drain as Record<string, unknown>
    const within = o.within === undefined ? 48 * 3600 : seconds(o.within)
    const left = o.left === undefined ? 20 : typeof o.left === 'number' && o.left > 0 && o.left <= 100 ? o.left : undefined
    if (within === undefined || within <= 0 || within > 7 * 86_400) errors.push('"drain": "within" is a time up to a week, such as "48h"')
    else if (left === undefined) errors.push('"drain": "left" is a percent from 1 to 100')
    else drain = { within, left }
  } else if (r.drain !== undefined && r.drain !== false) errors.push('"drain" is true, or { "within": "48h", "left": 20 }')
  return { on: r.on !== false, rules, ...(groups.length ? { groups } : {}), ...(keepWarm ? { keepWarm } : {}), ...(resume ? { resume } : {}),
    ...(r.queue === true ? { queue: true } : {}), ...(drain ? { drain } : {}), errors }
}

/** `guard.groups`: `{ "team": ["team@", "ops@"], "people": { "accounts": ["sam@"], "for": "its owner" } }`. */
function parseGroups(raw: unknown, errors: string[]): Group[] {
  if (raw === undefined) return []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('"groups" maps a group name to the parts of account lines in it, such as { "team": ["team@"] }')
    return []
  }
  const groups: Group[] = []
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = word(key)
    if (!/^[a-z0-9][a-z0-9._-]{0,30}$/.test(name) || name === OTHER_GROUP) {
      errors.push(`group "${key}": a name of letters, digits, dots or dashes, and not "${OTHER_GROUP}" (that's every account in no group)`)
      continue
    }
    const o = Array.isArray(value) || typeof value === 'string' ? { accounts: value } : (value as Record<string, unknown> | null) ?? {}
    const list = (Array.isArray(o.accounts) ? o.accounts : [o.accounts]).map(word).filter(Boolean)
    if (!list.length) {
      errors.push(`group "${key}" lists no accounts`)
      continue
    }
    const keepFor = typeof o.for === 'string' && o.for.trim() ? o.for.trim().slice(0, 60) : `the ${name} group`
    groups.push({ name, words: list, keepFor })
  }
  return groups
}

/** The group an account line belongs to; undefined with no reading. */
export function groupOf(groups: readonly Group[] | undefined, account: string | null | undefined): Group | undefined {
  const line = account?.toLowerCase()
  if (!line) return undefined
  return (groups ?? []).find(g => g.words.some(part => line.includes(part))) ?? { name: OTHER_GROUP, words: [], keepFor: 'others' }
}

// ------------------------------------------------------------------- pace

const WEEK_MS = 7 * 86_400_000
const DAY_MS = 86_400_000
const PACE_KEYS = ['reserve', 'burst', 'office', 'office_weight', 'tz', 'buffer', 'tiers', 'effort', 'agents']

/** `pace` in a rule: `{ "reserve": 10, "burst": 8, "office": "09:00-18:00 mon-fri", "office_weight": 4, "tz": "Asia/Kuala_Lumpur" }`. */
function parsePace(raw: unknown, ruleTz: string | undefined, n: number, errors: string[]): Pace | undefined {
  const fail = (why: string) => {
    errors.push(`rule ${n}: "pace" ${why}`)
    return undefined
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('is an object, such as { "reserve": 10, "burst": 8 }')
  const o = raw as Record<string, unknown>
  const unknown = Object.keys(o).filter(k => !PACE_KEYS.includes(k))
  if (unknown.length) return fail(`doesn't know ${unknown.map(k => `"${k}"`).join(', ')} (it takes ${PACE_KEYS.join(', ')})`)
  const num = (key: string, fallback: number, lo: number, hi: number): number | undefined => {
    const v = o[key]
    if (v === undefined) return fallback
    return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined
  }
  const reserve = num('reserve', 10, 0, 50)
  if (reserve === undefined) return fail('"reserve" is a percent from 0 to 50 of the week kept back')
  const burst = num('burst', 8, 0, 100 - reserve)
  if (burst === undefined) return fail(`"burst" is points of the week free from the start, from 0 to ${100 - reserve} (100 less the reserve)`)
  const buffer = num('buffer', 2, 0, 20)
  if (buffer === undefined) return fail('"buffer" is a few points of slack for a coarse reading, from 0 to 20')
  let office: Hours | undefined
  if (o.office !== undefined) {
    office = parseHours(o.office)
    if (!office) return fail('"office" is like "09:00-18:00 mon-fri"')
  }
  const officeWeight = num('office_weight', office ? 4 : 1, 0.1, 20)
  if (officeWeight === undefined) return fail('"office_weight" is how many times an office hour counts, from 0.1 to 20')
  let tiers: [number, number, number] = [0, 3, 6]
  if (o.tiers !== undefined) {
    const t = o.tiers
    const ok = Array.isArray(t) && t.length === 3 && t.every(x => typeof x === 'number' && Number.isFinite(x) && x >= -20 && x <= 50)
      && (t as number[])[0]! < (t as number[])[1]! && (t as number[])[1]! < (t as number[])[2]!
    if (!ok) return fail('"tiers" is three rising points ahead of pace, such as [0, 3, 6]: effort, cheaper agents, stop')
    tiers = [...(t as [number, number, number])]
  }
  const effort = o.effort === undefined ? 'medium' : word(o.effort)
  if (!(EFFORTS as readonly string[]).includes(effort)) return fail(`"effort" is one of ${EFFORTS.join(', ')}`)
  const agents = o.agents === undefined ? 'sonnet' : typeof o.agents === 'string' ? o.agents.trim() : ''
  if (!/^[a-z0-9._[\]-]{2,80}$/i.test(agents) || !rank(agents)) return fail('"agents" names a model family, such as "sonnet" or "haiku"')
  const tz = o.tz === undefined ? ruleTz || undefined : typeof o.tz === 'string' ? o.tz.trim() : ''
  if (tz !== undefined && (!tz || !localTime(0, tz))) return fail(`has an unknown time zone "${String(o.tz)}"`)
  return { reserve, burst, ...(office ? { office } : {}), officeWeight, ...(tz ? { tz } : {}), buffer, tiers, effort: effort as Effort, agents }
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>()

/** The zone's offset from UTC at `ms`, in ms: the named zone's (daylight saving included), else the machine's fixed `fallbackMinutes`. */
function zoneOffsetMs(tz: string | undefined, ms: number, fallbackMinutes: number): number | undefined {
  if (!tz) return fallbackMinutes * 60_000
  try {
    let f = zoneFormats.get(tz)
    if (!f) {
      f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      zoneFormats.set(tz, f)
    }
    const parts = f.formatToParts(new Date(ms))
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value)
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
    return Number.isFinite(asUtc) ? asUtc - Math.floor(ms / 1000) * 1000 : undefined
  } catch {
    return undefined
  }
}

/** The week of a pace rule: its office spans inside it, in UTC ms. */
export type PaceCalendar = { startMs: number; endMs: number; spans: [number, number][]; officeMs: number; weight: number }

/** The week ending at `resetMs`, with its office hours (in the rule's zone, daylight saving included) laid out once. */
export function paceCalendar(p: Pace, resetMs: number, offsetMinutes = 0): PaceCalendar | undefined {
  const startMs = resetMs - spanOf(p)
  const spans: [number, number][] = []
  if (p.office) {
    const off = (ms: number) => zoneOffsetMs(p.tz, ms, offsetMinutes)
    const at = off(startMs)
    if (at === undefined) return undefined
    const first = new Date(startMs + at)
    const [y, m, d] = [first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()]
    // A wall-clock minute of a calendar day (`dayMs` is that day's midnight read as UTC) as an instant.
    const instant = (dayMs: number, minute: number) => {
      const guess = dayMs + minute * 60_000
      const a = off(guess) ?? 0
      return guess - (off(guess - a) ?? a)
    }
    for (let i = -1; i <= 8; i++) {
      const dayMs = Date.UTC(y, m, d + i)
      if (!p.office.days.includes(new Date(dayMs).getUTCDay())) continue
      const from = instant(dayMs, p.office.from)
      const to = instant(p.office.from < p.office.to ? dayMs : dayMs + DAY_MS, p.office.to)
      const lo = Math.max(from, startMs)
      const hi = Math.min(to, resetMs)
      if (hi > lo) spans.push([lo, hi])
    }
  }
  return { startMs, endMs: resetMs, spans, officeMs: spans.reduce((sum, [a, b]) => sum + (b - a), 0), weight: p.officeWeight }
}

/** The weighted share of the week gone by `nowMs`, 0 to 1: an office hour counts `weight` times an ordinary one. */
export function paceFraction(cal: PaceCalendar, nowMs: number): number {
  const t = Math.min(cal.endMs, Math.max(cal.startMs, nowMs))
  const extra = cal.weight - 1
  const office = cal.spans.reduce((sum, [a, b]) => sum + Math.max(0, Math.min(b, t) - a), 0)
  return ((t - cal.startMs) + extra * office) / ((cal.endMs - cal.startMs) + extra * cal.officeMs)
}

/** What a week of the rule may have used by `nowMs`, in percent: `burst`, rising to `100 - reserve` by the reset. */
export function paceAllowance(p: Pace, cal: PaceCalendar, nowMs: number): number {
  const room = 100 - p.reserve
  return Math.min(room, p.burst + (room - p.burst) * paceFraction(cal, nowMs))
}

/** Where a pace rule stands: the week used, what's allowed by now, how far ahead, and the step that means. */
export type PaceNow = {
  used: number; allowed: number; ahead: number
  /** 0 on pace; 1 effort capped; 2 also cheaper new agents; 3 also stop. */
  tier: 0 | 1 | 2 | 3
  /** Stopped because the week's reserve itself is near, not only because of the pace. */
  hard: boolean
  reserve: number
  office: boolean
  /** The window paced. */
  window?: WindowName
  /** About when this step lets go on its own (ms), for a step in force. */
  liftsAt?: number
}

/** What a pace rule remembers, so a step lets go only after CLEAR_MARGIN points, and only in the window and for the account it began in. */
export type PaceMemory = { tier: number; hard: boolean; reset: number | null; account: string }

const calendars = new WeakMap<Pace, { key: string; cal: PaceCalendar | undefined }>()

function calendarOf(p: Pace, resetMs: number, offsetMinutes: number): PaceCalendar | undefined {
  const key = `${resetMs}|${p.tz ? '' : offsetMinutes}`
  const kept = calendars.get(p)
  if (kept?.key === key) return kept.cal
  const cal = paceCalendar(p, resetMs, offsetMinutes)
  calendars.set(p, { key, cal })
  return cal
}

/** The pace rule's standing against the weekly window now; nothing when the reading or the zone can't say. */
export function paceRead(p: Pace, w: { left: number; resetsAt: number }, nowMs: number, offsetMinutes = 0, was?: { tier: number; hard: boolean }): PaceNow | undefined {
  if (!Number.isFinite(w.left) || !Number.isFinite(w.resetsAt)) return undefined
  const resetMs = w.resetsAt * 1000
  if (resetMs <= nowMs || resetMs - nowMs > spanOf(p) + 3_600_000) return undefined
  const cal = calendarOf(p, resetMs, offsetMinutes)
  if (!cal) return undefined
  const used = Math.min(100, Math.max(0, 100 - w.left))
  const allowed = paceAllowance(p, cal, nowMs)
  const ahead = used + p.buffer - allowed
  let tier = 0
  for (let i = 0; i < 3; i++) if (ahead >= (p.tiers[i] ?? Infinity) - ((was?.tier ?? 0) >= i + 1 ? CLEAR_MARGIN : 0)) tier = i + 1
  const hard = w.left <= p.reserve + p.buffer + (was?.hard ? CLEAR_MARGIN : 0)
  if (hard) tier = 3
  const now: PaceNow = { used, allowed, ahead, tier: tier as PaceNow['tier'], hard, reserve: p.reserve,
    office: cal.spans.some(([a, b]) => nowMs >= a && nowMs < b), ...(p.window === '5h' ? { window: p.window } : {}) }
  if (tier > 0) {
    if (hard) now.liftsAt = resetMs
    else {
      // The allowance only rises: the first moment it climbs far enough for this step to let go.
      const target = used + p.buffer - ((p.tiers[tier - 1] ?? 0) - CLEAR_MARGIN)
      let lo = nowMs
      let hi = resetMs
      for (let i = 0; i < 40 && hi - lo > 1000; i++) {
        const mid = (lo + hi) / 2
        if (paceAllowance(p, cal, mid) >= target) hi = mid
        else lo = mid
      }
      now.liftsAt = Math.ceil(hi)
    }
  }
  return now
}

/** The standing in words: `ahead of pace: 62% of the week used, 48% allowed by now`. */
export function paceWords(n: PaceNow): string {
  return n.hard
    ? `${pct(100 - n.used)} of the ${paceName(n.window)} is left, inside the ${n.reserve}% g-line keeps back`
    : `ahead of pace: ${pct(n.used)} of the ${paceName(n.window)} used, ${pct(n.allowed)} allowed by now`
}

/** What the guard reads. `left` is percent of the window left; `resetsAt` in seconds. */
export type Facts = {
  nowMs: number
  windows: Partial<Record<WindowName, { left: number; resetsAt?: number }>>
  /** The `account_command` reading; undefined when unknown. */
  account?: string | null
  /** The machine's offset from UTC, for rules with no `tz`. */
  offsetMinutes?: number
}

/** Rules in force, by id, each with the window's reset it began in (a new window starts over). */
export type Active = Record<string, number | null>

export type Verdict = {
  active: Active
  rules: Rule[]
  /** Where each pace rule in force stands, by rule id. */
  pace?: Record<string, PaceNow>
  /** What each pace rule in force remembers (hand it back to `evaluate`). */
  memory?: Record<string, PaceMemory>
  effort?: Effort
  agents?: string
  stop?: Held
  /** The strictest stop in force that also ends a running turn. */
  end?: Held
}

/** A stop in force: its rule, the window and what's left, and the account's group when the rule names groups. */
export type Held = { rule: Rule; window: WindowName; left: number; resetsAt?: number; group?: Group; pace?: PaceNow }

/**
 * The rules in force now. A rule starts when its window's percent left falls to
 * its threshold and every condition it names holds; once in force it lets go only
 * when the window climbs CLEAR_MARGIN points past the threshold, the window
 * resets, or a condition stops holding (the account changed, the hours ended).
 */
export function evaluate(guard: GuardConfig, facts: Facts, before: Active = {}, memory: Record<string, PaceMemory> = {}): Verdict {
  const active: Active = {}
  const rules: Rule[] = []
  const paces: Record<string, PaceNow> = {}
  const kept: Record<string, PaceMemory> = {}
  if (!guard.on) return { active, rules }
  for (const rule of guard.rules) {
    const w = facts.windows[rule.window]
    if (!w || !Number.isFinite(w.left)) continue
    // A reading from before the window's reset says nothing about the new window.
    if (w.resetsAt !== undefined && w.resetsAt * 1000 <= facts.nowMs) continue
    const resets = w.resetsAt ?? null
    let pace: PaceNow | undefined
    if (rule.pace) {
      // The week is anchored on the engine's reset: with none, there is no week to pace.
      if (w.resetsAt === undefined) continue
      // A step's memory belongs to the account and the window it began in; any other starts afresh.
      const mem = memory[rule.id]
      const same = mem && mem.reset === resets && mem.account === accountKey(facts.account)
      pace = paceRead(rule.pace, { left: w.left, resetsAt: w.resetsAt }, facts.nowMs, facts.offsetMinutes, same ? mem : undefined)
      if (!pace || pace.tier === 0) continue
    } else {
      const was = Object.prototype.hasOwnProperty.call(before, rule.id) && before[rule.id] === resets
      if (w.left > rule.left + (was ? CLEAR_MARGIN : 0)) continue
    }
    if (rule.unlessResetWithin !== undefined) {
      if (w.resetsAt === undefined || w.resetsAt * 1000 - facts.nowMs <= rule.unlessResetWithin * 1000) continue
    }
    if (!inScope(guard, rule, facts)) continue
    active[rule.id] = resets
    rules.push(rule)
    if (pace) {
      paces[rule.id] = pace
      kept[rule.id] = { tier: pace.tier, hard: pace.hard, reset: resets, account: accountKey(facts.account) }
    }
  }
  const verdict: Verdict = { active, rules, ...(Object.keys(paces).length ? { pace: paces, memory: kept } : {}) }
  const group = groupOf(guard.groups, facts.account)
  for (const rule of rules) {
    const pace = paces[rule.id]
    // A pace rule's steps come one at a time with how far ahead of pace the week is.
    const effort = pace ? (pace.tier >= 1 ? rule.pace?.effort : undefined) : rule.effort
    const agents = pace ? (pace.tier >= 2 ? rule.pace?.agents : undefined) : rule.agents
    const stops = pace ? pace.tier >= 3 : rule.stop
    if (effort && (!verdict.effort || EFFORTS.indexOf(effort) < EFFORTS.indexOf(verdict.effort))) verdict.effort = effort
    // A model the guard can't rank must not mask a cheaper one it can.
    if (agents && (!verdict.agents || (rank(agents) > 0 && (rank(verdict.agents) === 0 || rank(agents) < rank(verdict.agents))))) verdict.agents = agents
    const w = facts.windows[rule.window]
    const held = w ? { rule, window: rule.window, left: w.left, resetsAt: w.resetsAt, ...(rule.groups && group ? { group } : {}), ...(pace ? { pace } : {}) } : undefined
    if (stops && held && binds(rule, held.left, verdict.stop)) verdict.stop = held
    if (stops && rule.endTurn && held && binds(rule, held.left, verdict.end)) verdict.end = held
  }
  return verdict
}

/** Whether the account, group and hours a rule names hold now. */
export function inScope(guard: GuardConfig, rule: Rule, facts: Facts): boolean {
  if (rule.accounts) {
    const account = facts.account?.toLowerCase()
    if (!account || !rule.accounts.some(part => account.includes(part))) return false
  }
  if (rule.exceptAccounts) {
    const account = facts.account?.toLowerCase()
    if (!account || rule.exceptAccounts.some(part => account.includes(part))) return false
  }
  if (rule.groups) {
    const g = groupOf(guard.groups, facts.account)
    if (!g || !rule.groups.includes(g.name)) return false
  }
  if (rule.hours) {
    const at = localTime(facts.nowMs, rule.tz, facts.offsetMinutes)
    if (!at || !inHours(rule.hours, at)) return false
  }
  return true
}

/**
 * Whether a stop rule gives the reason over the one chosen so far: the window
 * with less left; on the same reading, a team-seat rule, then the higher
 * threshold (the rule that started first), so the reason doesn't change from
 * one prompt to the next as stricter rules join it.
 */
function binds(rule: Rule, left: number, chosen: Verdict['stop']): boolean {
  if (!chosen) return true
  if (left !== chosen.left) return left < chosen.left
  const team = namesAccounts(rule)
  if (team !== namesAccounts(chosen.rule)) return team
  return rule.left > chosen.rule.left
}

/** Whether a rule depends on the account reading. */
export const namesAccounts = (rule: Rule) => Boolean(rule.accounts || rule.exceptAccounts || rule.groups)

/** A model family's price rank: haiku 1, sonnet 2, opus 3, fable or mythos 4; 0 unknown. */
export function rank(model: string | undefined): number {
  const m = (model ?? '').toLowerCase()
  if (m.includes('haiku')) return 1
  if (m.includes('sonnet')) return 2
  if (m.includes('opus')) return 3
  if (m.includes('fable') || m.includes('mythos')) return 4
  return 0
}

/** The lower of the request's effort and the guard's; nothing to change when it is already as low, or not a named level. */
export function cappedEffort(current: unknown, cap: Effort | undefined): Effort | undefined {
  if (!cap || typeof current !== 'string') return undefined
  const at = EFFORTS.indexOf(current as Effort)
  return at > EFFORTS.indexOf(cap) ? cap : undefined
}

/**
 * Whether a lower effort keeps the prompt cache: on Opus 5.5, Sonnet 5.5,
 * Haiku 5.5 and Fable 5.1 through the Claude API (an API key or a subscription),
 * as Claude Code's prompt-caching page says. Elsewhere a change of effort reads
 * the whole conversation again, so the guard waits for the cache to lapse.
 */
export function effortKeepsCache(model: string | undefined, env: { bedrock?: boolean; vertex?: boolean; foundry?: boolean; noBetas?: boolean }): boolean {
  if (env.bedrock || env.vertex || env.foundry || env.noBetas) return false
  return /opus-5-5|sonnet-5-5|haiku-5-5|fable-5-1|mythos-5-1/.test((model ?? '').toLowerCase())
}

/**
 * The model a new subagent runs on under the guard, or nothing to leave it.
 * Only ever cheaper: an agent that names, or is known to run on, a model at or
 * below the guard's keeps it. One whose model isn't known (an agent type whose
 * own definition picks it) is left alone, since it may already be cheaper. A
 * fork inherits the parent and can't change.
 */
export function agentModel(target: string | undefined, spawn: { model?: string; fork: boolean; known?: string }): string | undefined {
  if (!target || spawn.fork) return undefined
  const want = rank(target)
  if (!want) return undefined
  const now = rank(spawn.model ?? spawn.known)
  return now > want ? target : undefined
}

/**
 * What Claude Code's own agent types run on when the Agent call names no
 * model: the parent's (`inherit`) or a model of their own. Types not listed
 * are learned from what they ran on, and left alone until then.
 */
export const AGENT_TYPE_MODELS: Record<string, string> = {
  'general-purpose': 'inherit', Plan: 'inherit', Explore: 'haiku', 'claude-code-guide': 'haiku', 'statusline-setup': 'sonnet',
}

const pct = (n: number) => `${Math.max(0, Math.round(n))}%`
const NAMES: Record<WindowName, string> = { '5h': '5-hour', week: 'weekly' }

/** When a window resets, in the caller's zone: `08:20, in 1h 5m`, or `Tue 13:00, in 3d 4h`. */
function resetWords(resetsAt: number | undefined, nowMs: number, offsetMinutes: number): string {
  if (resetsAt === undefined) return ''
  const left = Math.max(0, Math.round(resetsAt - nowMs / 1000))
  const d = Math.floor(left / 86_400)
  const h = Math.floor((left % 86_400) / 3600)
  const m = Math.floor((left % 3600) / 60)
  const at = new Date(resetsAt * 1000 + offsetMinutes * 60_000)
  const hm = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
  const day = left >= 20 * 3600 ? `${(DAYS[at.getUTCDay()] ?? '').replace(/^./, c => c.toUpperCase())} ` : ''
  const span = d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
  return `${day}${hm}, in ${span}`
}

/** A rule's hours in words: `Mon-Fri 04:00-17:00 Kuala Lumpur time`. */
export function hoursWords(rule: Rule): string {
  if (!rule.hours) return ''
  const days = [...rule.hours.days].sort((a, b) => a - b)
  const name = (d: number) => (DAYS[d] ?? '').replace(/^./, c => c.toUpperCase())
  const run = days.length > 2 && days.every((d, i) => i === 0 || d === (days[i - 1] ?? 0) + 1)
  const span = days.length === 7 ? 'Every day' : run ? `${name(days[0] ?? 0)}-${name(days[days.length - 1] ?? 0)}` : days.map(name).join(', ')
  const zone = rule.tz ? ` ${(rule.tz.split('/').pop() ?? rule.tz).replace(/_/g, ' ')} time` : ''
  return `${span} ${hhmm(rule.hours.from)}-${hhmm(rule.hours.to)}${zone}`
}

/** The reason a stop is in force, in a sentence or two, without the way past. */
function reasonText(stop: NonNullable<Verdict['stop']>, simulated: boolean, account?: string | null): string {
  const window = `${NAMES[stop.window]} window`
  const sim = simulated ? ' (simulated)' : ''
  if (stop.pace) {
    const said = `${paceWords(stop.pace)}${sim}`
    if (!namesAccounts(stop.rule)) return `${said.replace(/^./, c => c.toUpperCase())}.`
    const who = account ? accountIdentity(account) : 'this account'
    const what = !stop.group ? 'a team seat' : stop.group.name === OTHER_GROUP ? 'in none of your groups' : `in your ${stop.group.name} group`
    return `${who} is ${what}, and ${said}. g-line paces the ${paceName(stop.pace.window)} so it lasts for ${stop.group?.keepFor ?? 'the team'}.`
  }
  if (namesAccounts(stop.rule)) {
    const who = account ? accountIdentity(account) : 'this account'
    const when = stop.rule.hours ? `${hoursWords(stop.rule)}, g-line keeps` : 'g-line keeps'
    const what = !stop.group ? 'a team seat' : stop.group.name === OTHER_GROUP ? 'in none of your groups' : `in your ${stop.group.name} group`
    return `${who} is ${what}, with ${pct(stop.left)} of its ${window} left${sim}. ${when} the last ${stop.rule.left}% of it for ${stop.group?.keepFor ?? 'the team'}.`
  }
  return `${pct(stop.left)} of the ${window} left${sim}, at or under your ${stop.rule.left}% stop.`
}

/** Why a prompt was held, when the window resets, and the way past: Enter again for a prompt the person typed. */
export function stopText(stop: NonNullable<Verdict['stop']>, nowMs: number, offsetMinutes: number, simulated = false,
  o: { account?: string | null; typed?: boolean; queued?: { at?: string; cache?: 'warm' | 'bridge' | 'cold' } } = {}): string {
  const reset = resetWords(stop.resetsAt, nowMs, offsetMinutes)
  const cache = o.queued?.cache === 'bridge' ? ', keeping the cache warm until then' : o.queued?.cache === 'cold' ? '; the cache will be cold by then' : ''
  const past = o.typed === false
    ? '/g-line guard pause lets prompts like this through for an hour.'
    : o.queued
      ? `g-line will send it when the guard lets it through${o.queued.at ? `, about ${o.queued.at}` : ''}${cache}. Enter again sends it now; /g-line guard cancel keeps it here.`
      : 'Press Enter again to send it anyway, or /g-line guard pause for an hour.'
  return `g-line held this prompt: ${reasonText(stop, simulated, o.account)}${reset ? ` It resets at ${reset}.` : ''} ${past}`
}

/**
 * About when a stop lets go on its own (ms): the window's reset, or sooner the
 * end of the rule's hours. Undefined when neither is known.
 */
export function liftsAt(held: Held, nowMs: number, offsetMinutes?: number): number | undefined {
  const reset = held.pace?.liftsAt ?? (held.resetsAt !== undefined ? held.resetsAt * 1000 : undefined)
  const hours = held.rule.hours
  if (!hours) return reset
  const at = localTime(nowMs, held.rule.tz, offsetMinutes)
  if (!at) return reset
  const end = nowMs + (((hours.to - at.minute) % 1440 + 1440) % 1440) * 60_000
  return reset === undefined ? end : Math.min(reset, end)
}

/** What a queue bridge reads: times in seconds, the window's percent left. */
export type BridgeFacts = { now: number; expiresAt?: number; sendAt?: number; left?: number; bridges: number; prefix: number }

/**
 * Whether a queued prompt's cache needs one re-read now to still be warm when the
 * prompt goes: it expires before the send, within four minutes, the window has
 * room for a read, the cache is worth it, and at most two bridges per prompt.
 */
export function bridgeDue(f: BridgeFacts): boolean {
  if (f.expiresAt === undefined || f.sendAt === undefined || f.expiresAt >= f.sendAt) return false
  if (f.now < f.expiresAt - 240 || f.now > f.expiresAt - 20) return false
  return (f.left ?? 0) > 1 && f.bridges < 2 && f.prefix >= 20_000
}

/** Why a running turn was ended, when the window resets, and how to carry on. */
export function endText(end: NonNullable<Verdict['end']>, nowMs: number, offsetMinutes: number, simulated = false, account?: string | null): string {
  const reset = resetWords(end.resetsAt, nowMs, offsetMinutes)
  return `g-line ended this turn before its next request: ${reasonText(end, simulated, account)}${reset ? ` It resets at ${reset}.` : ''}`
    + ' To carry on anyway, type "continue" and press Enter twice.'
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/** A rule in words: `at 10% of 5h left, on accounts "team@", 09:00-17:00 Mon-Fri (Asia/Kuala_Lumpur): stop`. */
export function ruleText(rule: Rule): string {
  const when = [rule.pace ? (rule.pace.window === '5h' ? 'paced 5h window' : 'paced week') : `at ${rule.left}% of ${rule.window} left`]
  if (rule.unlessResetWithin !== undefined) {
    const u = rule.unlessResetWithin
    when.push(`unless it resets within ${u >= 86_400 && u % 86_400 === 0 ? `${u / 86_400}d` : u >= 3600 && u % 3600 === 0 ? `${u / 3600}h` : `${Math.round(u / 60)}m`}`)
  }
  if (rule.accounts) when.push(`on accounts ${rule.accounts.map(a => `"${a}"`).join(', ')}`)
  if (rule.exceptAccounts) when.push(`on accounts except ${rule.exceptAccounts.map(a => `"${a}"`).join(', ')}`)
  if (rule.groups) when.push(`on ${rule.groups.length === 1 ? 'group' : 'groups'} ${rule.groups.join(', ')}`)
  if (rule.hours) {
    const days = rule.hours.days.length === 7 ? 'daily' : rule.hours.days.map(d => (DAYS[d] ?? '').replace(/^./, c => c.toUpperCase())).join(',')
    when.push(`${hhmm(rule.hours.from)}-${hhmm(rule.hours.to)} ${days}${rule.tz ? ` (${rule.tz})` : ''}`)
  }
  if (rule.pace) {
    const p = rule.pace
    const office = p.office ? `, office ${hoursWords({ ...rule, hours: p.office, tz: p.tz })} counts ${p.officeWeight}x` : p.tz ? `, ${p.tz}` : ''
    when.push(`keeps ${p.reserve}% back, ${p.burst}% free at the start${office}`)
    const steps = [`effort ${p.effort}`, `agents on ${p.agents}`, rule.endTurn ? 'stop new prompts and end a running turn' : 'stop new prompts']
    return `${when.join(', ')}: ${steps.map((x, i) => `${x} at ${p.tiers[i]} points ahead`).join(', ')}`
  }
  const what = [rule.effort ? `effort ${rule.effort}` : '', rule.agents ? `agents on ${rule.agents}` : '', rule.stop ? (rule.endTurn ? 'stop new prompts and end a running turn' : 'stop new prompts') : ''].filter(Boolean)
  return `${when.join(', ')}: ${what.join(', ')}`
}

/** What's in force, in a few words: `stop (4% of 5h left), effort low, agents on haiku`. */
export function inForceText(v: Verdict): string {
  return [v.stop ? (v.stop.pace ? `stop (${paceWords(v.stop.pace)})` : `stop (${pct(v.stop.left)} of ${v.stop.window} left)`) : '', v.effort ? `effort ${v.effort}` : '', v.agents ? `agents on ${v.agents}` : '']
    .filter(Boolean).join(', ')
}

/** What a pace rule's steps are, by tier 1 to 3. */
const paceSteps = (rule: Rule, from: number, to: number): string[] => {
  const p = rule.pace
  if (!p) return []
  const steps = [`the conversation runs at effort ${p.effort}`, `new subagents run on ${p.agents}`, 'new prompts stop']
  return steps.slice(from, to)
}

/** What changed between two verdicts, in words for a toast; nothing when nothing did. */
export function changeText(before: Verdict | undefined, after: Verdict): string | undefined {
  const was = new Set(before?.rules.map(r => r.id) ?? [])
  const started = after.rules.filter(r => !was.has(r.id))
  const parts: string[] = []
  // A pace rule climbing a step says where the week stands and what now applies.
  for (const rule of after.rules) {
    const at = after.pace?.[rule.id]
    if (!at) continue
    const from = before?.pace?.[rule.id]?.tier ?? 0
    if (at.tier > from) parts.push(`${paceWords(at)}: ${paceSteps(rule, from, at.tier).join(', ')}`)
  }
  if (after.stop && started.includes(after.stop.rule) && !after.stop.pace) parts.push(`new prompts stop (${pct(after.stop.left)} of the ${NAMES[after.stop.window]} window left)`)
  if (after.effort && started.some(r => r.effort)) parts.push(`the conversation runs at effort ${after.effort}`)
  if (after.agents && started.some(r => r.agents)) parts.push(`new subagents run on ${after.agents}`)
  if (before?.effort && after.effort && before.effort !== after.effort) parts.push(`the conversation now runs at effort ${after.effort}`)
  if (before?.agents && after.agents && before.agents !== after.agents) parts.push(`new subagents now run on ${after.agents}`)
  if (before?.stop && !after.stop) parts.push('prompts go through again')
  if (before?.effort && !after.effort) parts.push('effort is yours again')
  if (before?.agents && !after.agents) parts.push('subagents pick their own model again')
  if (!parts.length) return undefined
  return `g-line guard: ${parts.join('; ')}.`
}

/** Line 2's guard segment words, widest first: what's in force, or that it's paused. */
export function guardForms(verdict: Verdict, pausedFor?: number, until?: string, queued = false): { forms: string[]; tone: 'bad' | 'warn' | 'dim' } | undefined {
  if (pausedFor !== undefined && pausedFor > 0 && verdict.rules.length) {
    const m = Math.ceil(pausedFor / 60)
    return { forms: [`guard paused ${m}m`, 'guard paused'], tone: 'dim' }
  }
  if (verdict.stop?.pace) {
    // A pace step's lift is reckoned from the allowance's growth: about, not exact.
    const till = until ? ` till ~${until}` : ''
    const forms = [`guard: over pace, ${pct(verdict.stop.pace.used)} of the ${verdict.stop.pace.window === '5h' ? '5h' : 'week'} used${till}`, `over pace${till}`, 'over pace']
    return { forms: queued ? forms.map((f, i) => (i < forms.length - 1 ? `${f}, 1 queued` : f)) : forms, tone: 'bad' }
  }
  if (verdict.stop) {
    const till = until ? ` till ${until}` : ''
    const reserve = `${verdict.stop.group?.name ?? 'team'} reserve`
    const forms = namesAccounts(verdict.stop.rule)
      ? [`guard: ${reserve}, ${pct(verdict.stop.left)} ${verdict.stop.window} left${till}`, `${reserve}${till}`, reserve]
      : [`guard: held, ${pct(verdict.stop.left)} ${verdict.stop.window} left${till}`, `guard: held${till}`, 'guard: held']
    return { forms: queued ? forms.map((f, i) => (i < forms.length - 1 ? `${f}, 1 queued` : f)) : forms, tone: 'bad' }
  }
  const doing = [verdict.effort ? `effort ${verdict.effort}` : '', verdict.agents ? `agents ${verdict.agents}` : ''].filter(Boolean)
  if (!doing.length) return undefined
  const paced = verdict.pace && verdict.rules.every(r => r.pace)
  return { forms: paced ? [`guard: over pace, ${doing.join(', ')}`, 'over pace'] : [`guard: ${doing.join(', ')}`, 'guard on'], tone: 'warn' }
}

/** What keep-warm reads. Times in seconds. */
export type WarmFacts = {
  now: number
  /** When the main conversation's last request started. */
  lastAt: number
  ttl: '5m' | '1h'
  /** Tokens the cache holds: the next request's prefix. */
  prefix: number
  compacted: boolean
  /** Claude Code's idle compaction will summarise this conversation before the cache expires. */
  compactionCovers: boolean
  /** Re-reads already made since the last real request. */
  done: number
  /** Re-reads every session on the machine made this hour. */
  thisHour: number
  fiveHourLeft?: number
  /** A guard stop rule is in force. */
  stopped: boolean
  /** A turn is running. */
  busy: boolean
  /** Seconds added to `after`, so sessions idle since the same moment don't all re-read at once. */
  jitter: number
  /** The account changed since the cache was written: it belongs to the other account. */
  accountChanged?: boolean
  /** The model changed (`/model`) since the last request: its cache is the old model's. */
  modelChanged?: boolean
  /** Another session on this account was typed in more recently (`sessions: last`). */
  notLastTouched?: boolean
  /** Another session on this account holds the re-read for now. */
  leased?: boolean
}

/** Idle seconds after which an hour-long cache may already be gone. */
const WARM_LAPSE = 3600 - 120

/** Why keep-warm re-reads now, or why it won't: the first reason that holds. */
export function warmDue(k: KeepWarm | undefined, f: WarmFacts): { due: boolean; why: string } {
  if (!k) return { due: false, why: 'off' }
  if (f.busy) return { due: false, why: 'a turn is running' }
  if (f.ttl !== '1h') return { due: false, why: 'the cache lives 5 minutes (over the plan limit, on credits, or by setting)' }
  if (f.compacted) return { due: false, why: 'the conversation was compacted' }
  if (f.accountChanged) return { due: false, why: 'the account changed' }
  if (f.modelChanged) return { due: false, why: 'the model changed' }
  if (f.compactionCovers) return { due: false, why: 'Claude Code compacts this conversation when idle' }
  if (f.prefix < k.minContext) return { due: false, why: 'too small to be worth keeping' }
  if (f.stopped) return { due: false, why: 'a guard stop is in force' }
  if (f.fiveHourLeft === undefined || !Number.isFinite(f.fiveHourLeft) || f.fiveHourLeft < k.minLeft) return { due: false, why: 'the 5-hour window is low' }
  if (f.done >= k.max) return { due: false, why: 'kept warm as many times as allowed' }
  if (f.thisHour >= k.perHour) return { due: false, why: 'the hourly limit on this account is reached' }
  if (k.sessions === 'last' && f.notLastTouched) return { due: false, why: 'you typed in another session on this account last' }
  if (f.leased) return { due: false, why: 'another session on this account is re-reading' }
  const idle = f.now - f.lastAt
  // Two minutes before the hour is up the cache may already be gone: a re-read then would rebuild it.
  // `after` plus the spread stops a minute short of that, so a late `after` still gets its chance.
  if (idle < Math.min(k.after + f.jitter, WARM_LAPSE - 60)) return { due: false, why: 'not idle long enough' }
  if (idle > WARM_LAPSE) return { due: false, why: 'the cache has lapsed' }
  return { due: true, why: 'idle' }
}

/**
 * Whether a re-read found the cache: it read most of the conversation and
 * wrote little. A read of nothing, or writes of 10% or more of what it read,
 * mean the cache it meant to keep wasn't there, so keep-warm stands down.
 */
export function readBack(prefix: number, usage: { cache_read_input_tokens: number; cache_creation_input_tokens: number } | undefined): boolean {
  if (!usage || usage.cache_read_input_tokens <= 0) return false
  return usage.cache_read_input_tokens >= prefix * 0.5 && usage.cache_creation_input_tokens < usage.cache_read_input_tokens * 0.1
}

/**
 * The account an `account_command` line names, without a leading `account`
 * and a trailing `(…)` note (a plan, a quota, `via CAAM`) that can change
 * while the account stays the same: `account you@example.com (82% left)`
 * reads `you@example.com`.
 */
export function accountIdentity(line: string | null | undefined): string {
  const text = (line ?? '').trim()
  return text.replace(/^account\s+/i, '').replace(/\s*\([^()]*\)$/, '').trim() || text
}

/** The store's name for an account's share of keep-warm and resume: its reading, or the machine's when there is none. */
export function accountKey(account: string | null | undefined): string {
  const a = accountIdentity(account).toLowerCase().replace(/[^a-z0-9@._+-]+/g, '_').slice(0, 80)
  return a || 'machine'
}

/** A lease on `key` for `holder` until `until` (ms): free, expired, or already the holder's. */
export function leaseFree(lease: unknown, holder: string, nowMs: number): boolean {
  if (!lease || typeof lease !== 'object') return true
  const l = lease as { holder?: unknown; until?: unknown }
  return l.holder === holder || typeof l.until !== 'number' || !Number.isFinite(l.until) || l.until <= nowMs
}

/** `kept warm 2× · $0.18` for line 2 while re-reads hold the cache; the cost only when known. */
export function warmForms(count: number, cost?: number): string[] {
  if (count <= 0) return []
  const money = cost !== undefined && cost > 0 ? ` · ${cost < 0.005 ? '<$0.01' : `$${cost.toFixed(2)}`}` : ''
  return money ? [`kept warm ${count}×${money}`, `kept warm ${count}×`] : [`kept warm ${count}×`]
}

export type Simulation = { window: WindowName; used: number; until: number }

/** `/g-line guard simulate 5h 96`: the window's reading replaced for the guard alone, reset two hours out when unknown. */
export function simulated(facts: Facts, sim: Simulation | undefined): Facts {
  if (!sim || sim.until <= facts.nowMs) return facts
  const real = facts.windows[sim.window]
  const resetsAt = real?.resetsAt && real.resetsAt * 1000 > facts.nowMs ? real.resetsAt : Math.floor(facts.nowMs / 1000) + 2 * 3600
  return { ...facts, windows: { ...facts.windows, [sim.window]: { left: 100 - sim.used, resetsAt } } }
}

/**
 * When a stopped turn can go on: the reset of every window that reads full
 * (100% used), the latest of them, plus `jitterSeconds` so sessions on one
 * account don't all start at once. Nothing when no window reads full, or a
 * full one has no reset time.
 */
export function resumeAt(limits: readonly { kind: string; percentUsed: number; resetsAt?: number }[], nowMs: number, jitterSeconds: number):
  { at: number; window: WindowName } | undefined {
  const full = limits.filter(l => (l.kind === 'five_hour' || l.kind === 'seven_day') && l.percentUsed >= 100)
  if (!full.length || full.some(l => l.resetsAt === undefined || !Number.isFinite(l.resetsAt) || l.resetsAt * 1000 <= nowMs)) return undefined
  const last = full.reduce((a, b) => ((b.resetsAt ?? 0) > (a.resetsAt ?? 0) ? b : a))
  return { at: (last.resetsAt ?? 0) * 1000 + Math.max(0, Math.round(Number.isFinite(jitterSeconds) ? jitterSeconds : 0)) * 1000, window: last.kind === 'five_hour' ? '5h' : 'week' }
}

/**
 * What a held decision or a pass is bound to: the account and the window (and its reset)
 * it was made for. An account switch, or a window that has reset since, makes it a
 * different epoch, and whatever was bound to the old one (a pass for one prompt, a prompt
 * sent again, a queued prompt) no longer carries over.
 */
export function epochOf(account: string | null | undefined, held?: { window: WindowName; resetsAt?: number }): string {
  return `${accountKey(account)}|${held ? `${held.window}:${held.resetsAt ?? ''}` : '-'}`
}

/** `/g-line guard why`: the figures, each rule's state, the account's group, the pace allowance now and when the hold lifts. */
export function whyLines(guard: GuardConfig, facts: Facts, verdict: Verdict, o: { pausedFor?: number; simulated?: boolean } = {}): string[] {
  const out: string[] = []
  const offset = facts.offsetMinutes ?? 0
  if (!guard.rules.length) return ['No guard rules: write them under "guard" in config.json.']
  if (!guard.on) out.push('The guard is off (/g-line guard on).')
  if (o.simulated) out.push('These are simulated readings.')
  if (o.pausedFor && o.pausedFor > 0) out.push(`Paused for ${Math.ceil(o.pausedFor / 60)} more minutes.`)
  for (const name of ['week', '5h'] as const) {
    const w = facts.windows[name]
    const reset = w?.resetsAt !== undefined ? ` Resets ${resetWords(w.resetsAt, facts.nowMs, offset)}.` : ''
    out.push(w && Number.isFinite(w.left) ? `${NAMES[name].replace(/^./, c => c.toUpperCase())} window: ${pct(100 - w.left)} used, ${pct(w.left)} left.${reset}` : `${NAMES[name].replace(/^./, c => c.toUpperCase())} window: no reading yet.`)
  }
  if (guard.groups?.length) {
    const g = groupOf(guard.groups, facts.account)
    out.push(g ? `This account is in group ${g.name}.` : 'No account reading yet, so no group.')
  }
  for (const rule of guard.rules) {
    const w = facts.windows[rule.window]
    const label = ruleText(rule)
    if (!w || !Number.isFinite(w.left)) {
      out.push(`${label}: no ${NAMES[rule.window]} reading yet, so it waits.`)
      continue
    }
    const on = verdict.active[rule.id] !== undefined
    const scope = inScope(guard, rule, facts)
    if (rule.pace) {
      const now = verdict.pace?.[rule.id] ?? (w.resetsAt !== undefined ? paceRead(rule.pace, { left: w.left, resetsAt: w.resetsAt }, facts.nowMs, facts.offsetMinutes) : undefined)
      if (!now) {
        out.push(`${label}: the engine gave no reset time for the ${paceName(rule.pace.window)}, so there's nothing to pace.`)
        continue
      }
      const figures = `${pct(now.used)} of the ${paceName(now.window)} used, ${pct(now.allowed)} allowed by now${now.office ? ' (office hours)' : ''}`
      const state = on ? `step ${now.tier} of 3 in force${now.hard ? ' (inside the reserve)' : ''}` : now.tier > 0 && !scope ? 'waits (not this account or hours)' : 'on pace'
      out.push(`${label}: ${figures}; ${state}.`)
    } else {
      out.push(`${label}: ${pct(w.left)} left; ${on ? 'in force' : scope ? 'not reached' : 'waits (not this account or hours)'}.`)
    }
  }
  if (verdict.stop) {
    const lift = liftsAt(verdict.stop, facts.nowMs, facts.offsetMinutes)
    out.push(`Held: new prompts stop. ${lift !== undefined ? `The hold lifts about ${resetWords(Math.floor(lift / 1000), facts.nowMs, offset)}.` : 'No lift time is known.'}`)
  } else if (verdict.effort || verdict.agents) {
    const steps = Object.values(verdict.pace ?? {}).map(n => n.liftsAt).filter((x): x is number => x !== undefined)
    const next = steps.length ? Math.min(...steps) : undefined
    out.push(`In force: ${inForceText(verdict)}.${next !== undefined ? ` The next step eases about ${resetWords(Math.floor(next / 1000), facts.nowMs, offset)}.` : ''}`)
  } else out.push('Nothing is held now.')
  return out
}

/**
 * Near the weekly reset, what's left of the week is there to use: the words for it, once
 * the week resets within `drain.within` with `drain.left` percent or more left, else
 * nothing. Says what the guard still keeps back for this account, if anything.
 */
export function drainText(guard: GuardConfig, facts: Facts, account?: string | null): string | undefined {
  const d = guard.drain
  const w = facts.windows.week
  if (!d || !guard.on || !w || w.resetsAt === undefined) return undefined
  const until = w.resetsAt * 1000 - facts.nowMs
  if (until <= 0 || until > d.within * 1000 || w.left < d.left) return undefined
  // What a week stop rule in force for this account, now or later this week, keeps back.
  const keeps = guard.rules.filter(r => r.window === 'week' && r.stop && !r.pace && inScope(guard, r, facts)
    && (r.unlessResetWithin === undefined || until > r.unlessResetWithin * 1000)).map(r => r.left)
  const keep = keeps.length ? Math.max(...keeps) : 0
  const who = account ? `${accountIdentity(account)} has` : 'This account has'
  const reset = resetWords(w.resetsAt, facts.nowMs, facts.offsetMinutes ?? 0)
  return `${who} ${pct(w.left)} of its week left, and it resets at ${reset}. It's yours to use${keep ? `: g-line keeps only the last ${pct(keep)}` : ''}.`
}
