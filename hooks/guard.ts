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
  /** The rule waits while the window resets within this many seconds. */
  unlessResetWithin?: number
  /** Lower-case parts of the account reading, any of which picks the account. */
  accounts?: string[]
  hours?: Hours
  tz?: string
  /** The rule as written, for toasts. */
  text: string
}

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

export type GuardConfig = { on: boolean; rules: Rule[]; keepWarm?: KeepWarm; errors: string[] }

export const NO_GUARD: GuardConfig = { on: true, rules: [], errors: [] }

export const KEEP_WARM_DEFAULTS: KeepWarm = { sessions: 'last', after: 45 * 60, max: 2, minContext: 50_000, minLeft: 20, perHour: 6 }

/** `45m`, `1h`, `90s`, `1h30m`, or a number of minutes, in seconds. */
export function seconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value * 60
  if (typeof value !== 'string') return undefined
  const text = value.trim().toLowerCase()
  if (!/^(\d+(\.\d+)?\s*[hms]\s*)+$/.test(text)) return undefined
  let total = 0
  for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/g)) total += Number(n) * (unit === 'h' ? 3600 : unit === 'm' ? 60 : 1)
  return total
}

/** `50k`, `1.2m`, `50000`, in tokens. */
export function tokenCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value !== 'string') return undefined
  const m = /^(\d+(?:\.\d+)?)\s*([km]?)$/i.exec(value.trim())
  if (!m) return undefined
  return Number(m[1]) * (m[2]?.toLowerCase() === 'k' ? 1000 : m[2]?.toLowerCase() === 'm' ? 1_000_000 : 1)
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** `09:00-17:00 mon-fri`, `22:00-06:00`, `9-17 sat,sun`: minutes of the day and the days (0 = Sunday). */
export function parseHours(value: unknown): Hours | undefined {
  if (typeof value !== 'string') return undefined
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(.*)$/.exec(value.toLowerCase())
  if (!m) return undefined
  const from = Number(m[1]) * 60 + Number(m[2] ?? 0)
  const to = Number(m[3]) * 60 + Number(m[4] ?? 0)
  if (from > 24 * 60 || to > 24 * 60 || from === to) return undefined
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
  const list = Array.isArray(r.rules) ? r.rules : []
  list.forEach((entry, index) => {
    const text = JSON.stringify(entry)
    if (!entry || typeof entry !== 'object') {
      errors.push(`rule ${index + 1} is not an object`)
      return
    }
    const e = entry as Record<string, unknown>
    const left = typeof e.left === 'number' ? e.left : Number.NaN
    if (!(left > 0 && left <= 100)) {
      errors.push(`rule ${index + 1}: "left" must be a percent from 1 to 100`)
      return
    }
    const rule: Rule = { id: `r${index}`, left, window: word(e.window) === 'week' ? 'week' : '5h', text }
    if (e.window !== undefined && !['5h', 'week'].includes(word(e.window))) errors.push(`rule ${index + 1}: "window" is "5h" or "week"`)
    if (e.effort !== undefined) {
      if ((EFFORTS as readonly string[]).includes(word(e.effort))) rule.effort = word(e.effort) as Effort
      else errors.push(`rule ${index + 1}: "effort" is one of ${EFFORTS.join(', ')}`)
    }
    if (typeof e.agents === 'string' && /^[a-z0-9._[\]-]{2,80}$/i.test(e.agents.trim())) rule.agents = e.agents.trim()
    else if (e.agents !== undefined) errors.push(`rule ${index + 1}: "agents" names a model, such as "sonnet"`)
    if (e.stop === true) rule.stop = true
    if (!rule.effort && !rule.agents && !rule.stop) {
      errors.push(`rule ${index + 1} does nothing: give it "effort", "agents" or "stop": true`)
      return
    }
    if (e.unless_reset_within !== undefined) {
      const s = seconds(e.unless_reset_within)
      if (s === undefined) errors.push(`rule ${index + 1}: "unless_reset_within" is a time such as "1h"`)
      else rule.unlessResetWithin = s
    }
    if (e.accounts !== undefined) {
      const accounts = (Array.isArray(e.accounts) ? e.accounts : [e.accounts]).map(word).filter(Boolean)
      if (accounts.length) rule.accounts = accounts
      else errors.push(`rule ${index + 1}: "accounts" lists parts of the account line, such as "team@"`)
    }
    if (e.hours !== undefined) {
      const hours = parseHours(e.hours)
      if (hours) rule.hours = hours
      else {
        errors.push(`rule ${index + 1}: "hours" is like "09:00-17:00 mon-fri"`)
        return
      }
    }
    if (typeof e.tz === 'string' && e.tz.trim()) {
      rule.tz = e.tz.trim()
      if (!localTime(0, rule.tz)) {
        errors.push(`rule ${index + 1}: unknown time zone "${rule.tz}"`)
        return
      }
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
  return { on: r.on !== false, rules, ...(keepWarm ? { keepWarm } : {}), errors }
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
  effort?: Effort
  agents?: string
  stop?: { rule: Rule; window: WindowName; left: number; resetsAt?: number }
}

/**
 * The rules in force now. A rule starts when its window's percent left falls to
 * its threshold and every condition it names holds; once in force it lets go only
 * when the window climbs CLEAR_MARGIN points past the threshold, the window
 * resets, or a condition stops holding (the account changed, the hours ended).
 */
export function evaluate(guard: GuardConfig, facts: Facts, before: Active = {}): Verdict {
  const active: Active = {}
  const rules: Rule[] = []
  if (!guard.on) return { active, rules }
  for (const rule of guard.rules) {
    const w = facts.windows[rule.window]
    if (!w || !Number.isFinite(w.left)) continue
    // A reading from before the window's reset says nothing about the new window.
    if (w.resetsAt !== undefined && w.resetsAt * 1000 <= facts.nowMs) continue
    const resets = w.resetsAt ?? null
    const was = Object.prototype.hasOwnProperty.call(before, rule.id) && before[rule.id] === resets
    if (w.left > rule.left + (was ? CLEAR_MARGIN : 0)) continue
    if (rule.unlessResetWithin !== undefined) {
      if (w.resetsAt === undefined || w.resetsAt * 1000 - facts.nowMs <= rule.unlessResetWithin * 1000) continue
    }
    if (rule.accounts) {
      const account = facts.account?.toLowerCase()
      if (!account || !rule.accounts.some(part => account.includes(part))) continue
    }
    if (rule.hours) {
      const at = localTime(facts.nowMs, rule.tz, facts.offsetMinutes)
      if (!at || !inHours(rule.hours, at)) continue
    }
    active[rule.id] = resets
    rules.push(rule)
  }
  const verdict: Verdict = { active, rules }
  for (const rule of rules) {
    if (rule.effort && (!verdict.effort || EFFORTS.indexOf(rule.effort) < EFFORTS.indexOf(verdict.effort))) verdict.effort = rule.effort
    if (rule.agents && (!verdict.agents || rank(rule.agents) < rank(verdict.agents))) verdict.agents = rule.agents
    const w = facts.windows[rule.window]
    if (rule.stop && w && (!verdict.stop || w.left < verdict.stop.left)) verdict.stop = { rule, window: rule.window, left: w.left, resetsAt: w.resetsAt }
  }
  return verdict
}

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
 * below the guard's keeps it. A fork inherits the parent and can't change.
 */
export function agentModel(target: string | undefined, spawn: { model?: string; parentModel: string; fork: boolean; known?: string }): string | undefined {
  if (!target || spawn.fork) return undefined
  const want = rank(target)
  if (!want) return undefined
  const runs = spawn.model ?? spawn.known ?? spawn.parentModel
  const now = rank(runs)
  return now > want ? target : undefined
}

const pct = (n: number) => `${Math.max(0, Math.round(n))}%`
const NAMES: Record<WindowName, string> = { '5h': '5-hour', week: 'weekly' }

function untilText(resetsAt: number | undefined, nowMs: number, offsetMinutes: number): string {
  if (resetsAt === undefined) return ''
  const left = Math.max(0, Math.round(resetsAt - nowMs / 1000))
  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  const at = new Date(resetsAt * 1000 + offsetMinutes * 60_000)
  const clock = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
  return ` It resets at ${clock}, in ${h ? `${h}h ${m}m` : `${m}m`}.`
}

/** Why a prompt was refused: the window, how much is left, when it resets, and the way past. */
export function stopText(stop: NonNullable<Verdict['stop']>, nowMs: number, offsetMinutes: number): string {
  const whose = stop.rule.accounts ? ' on this shared account' : ''
  const hours = stop.rule.hours ? ' in these hours' : ''
  return `g-line guard stopped this prompt: ${pct(stop.left)} of the ${NAMES[stop.window]} window left${whose}${hours} (your rule: stop at ${stop.rule.left}%).`
    + `${untilText(stop.resetsAt, nowMs, offsetMinutes)} /g-line guard once lets the next prompt through; /g-line guard pause, an hour of them.`
}

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`

/** A rule in words: `at 10% of 5h left, on accounts "team@", 09:00-17:00 Mon-Fri (Asia/Kuala_Lumpur): stop`. */
export function ruleText(rule: Rule): string {
  const when = [`at ${rule.left}% of ${rule.window} left`]
  if (rule.unlessResetWithin !== undefined) when.push(`unless it resets within ${Math.round(rule.unlessResetWithin / 60)}m`)
  if (rule.accounts) when.push(`on accounts ${rule.accounts.map(a => `"${a}"`).join(', ')}`)
  if (rule.hours) {
    const days = rule.hours.days.length === 7 ? 'daily' : rule.hours.days.map(d => (DAYS[d] ?? '').replace(/^./, c => c.toUpperCase())).join(',')
    when.push(`${hhmm(rule.hours.from)}-${hhmm(rule.hours.to)} ${days}${rule.tz ? ` (${rule.tz})` : ''}`)
  }
  const what = [rule.effort ? `effort ${rule.effort}` : '', rule.agents ? `agents on ${rule.agents}` : '', rule.stop ? 'stop new prompts' : ''].filter(Boolean)
  return `${when.join(', ')}: ${what.join(', ')}`
}

/** What changed between two verdicts, in words for a toast; nothing when nothing did. */
export function changeText(before: Verdict | undefined, after: Verdict): string | undefined {
  const was = new Set(before?.rules.map(r => r.id) ?? [])
  const now = new Set(after.rules.map(r => r.id))
  const started = after.rules.filter(r => !was.has(r.id))
  const ended = (before?.rules ?? []).filter(r => !now.has(r.id))
  if (!started.length && !ended.length) return undefined
  const parts: string[] = []
  if (after.stop && started.includes(after.stop.rule)) parts.push(`new prompts stop (${pct(after.stop.left)} of the ${NAMES[after.stop.window]} window left)`)
  if (after.effort && started.some(r => r.effort)) parts.push(`the conversation runs at effort ${after.effort}`)
  if (after.agents && started.some(r => r.agents)) parts.push(`new subagents run on ${after.agents}`)
  if (before?.stop && !after.stop) parts.push('prompts go through again')
  if (before?.effort && !after.effort) parts.push('effort is yours again')
  if (before?.agents && !after.agents) parts.push('subagents pick their own model again')
  if (!parts.length) return undefined
  return `g-line guard: ${parts.join('; ')}.`
}

/** Line 2's guard segment words, widest first: what's in force, or that it's paused. */
export function guardForms(verdict: Verdict, pausedFor?: number): { forms: string[]; tone: 'bad' | 'warn' | 'dim' } | undefined {
  if (pausedFor !== undefined && pausedFor > 0 && verdict.rules.length) {
    const m = Math.ceil(pausedFor / 60)
    return { forms: [`guard paused ${m}m`, 'guard paused'], tone: 'dim' }
  }
  if (verdict.stop) return { forms: [`guard: stopped, ${pct(verdict.stop.left)} ${verdict.stop.window} left`, 'guard: stopped'], tone: 'bad' }
  const doing = [verdict.effort ? `effort ${verdict.effort}` : '', verdict.agents ? `agents ${verdict.agents}` : ''].filter(Boolean)
  if (!doing.length) return undefined
  return { forms: [`guard: ${doing.join(', ')}`, 'guard on'], tone: 'warn' }
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
  if (f.fiveHourLeft === undefined || f.fiveHourLeft < k.minLeft) return { due: false, why: 'the 5-hour window is low' }
  if (f.done >= k.max) return { due: false, why: 'kept warm as many times as allowed' }
  if (f.thisHour >= k.perHour) return { due: false, why: 'the hourly limit on this account is reached' }
  if (k.sessions === 'last' && f.notLastTouched) return { due: false, why: 'you typed in another session on this account last' }
  if (f.leased) return { due: false, why: 'another session on this account is re-reading' }
  const idle = f.now - f.lastAt
  if (idle < k.after + f.jitter) return { due: false, why: 'not idle long enough' }
  // Two minutes before the hour is up the cache may already be gone: a re-read then would rebuild it.
  if (idle > 3600 - 120) return { due: false, why: 'the cache has lapsed' }
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

/** The store's name for an account's share of keep-warm and resume: its reading, or the machine's when there is none. */
export function accountKey(account: string | null | undefined): string {
  const a = (account ?? '').trim().toLowerCase().replace(/[^a-z0-9@._+-]+/g, '_').slice(0, 80)
  return a || 'machine'
}

/** A lease on `key` for `holder` until `until` (ms): free, expired, or already the holder's. */
export function leaseFree(lease: unknown, holder: string, nowMs: number): boolean {
  if (!lease || typeof lease !== 'object') return true
  const l = lease as { holder?: unknown; until?: unknown }
  return l.holder === holder || typeof l.until !== 'number' || l.until <= nowMs
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
