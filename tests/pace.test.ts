import { expect, test } from 'claude-code/testing'

import {
  changeText, drainText, epochOf, evaluate, guardForms, liftsAt, paceAllowance, paceCalendar, paceFraction, paceRead, paceWords, parseGuard, parseHours,
  ruleText, seconds, stopText, tokenCount, whyLines, accountKey, leaseFree, resumeAt, warmDue, KEEP_WARM_DEFAULTS,
} from '../hooks/guard'
import type { Facts, GuardConfig, Pace, WarmFacts } from '../hooks/guard'

const HOUR = 3_600_000
const KL = 'Asia/Kuala_Lumpur'
// The week ends Sat 2026-10-24 10:00 in Kuala Lumpur (UTC+8) and began Sat 2026-10-17 10:00.
const RESET_MS = Date.parse('2026-10-24T02:00:00Z')
const RESET = RESET_MS / 1000
const at = (iso: string) => Date.parse(iso)

const PACE = { reserve: 10, burst: 8, office: '09:00-18:00 mon-fri', office_weight: 4, tz: KL }
const GUARD = parseGuard({
  groups: { team: ['team@'], people: ['sam@'] },
  rules: [{ groups: ['team', 'other'], pace: PACE, end_turn: true }],
})
const pace = GUARD.rules[0]?.pace as Pace

function near(a: number, b: number): void {
  expect(Math.abs(a - b)).toBeLessThan(1e-6)
}

function week(used: number, nowMs: number, resetsAt = RESET, account: string | null = 'team@example.com'): Facts {
  return { nowMs, account, offsetMinutes: 480, windows: { week: { left: 100 - used, resetsAt }, '5h': { left: 90, resetsAt: Math.floor(nowMs / 1000) + 3600 } } }
}

// Mon 2026-10-19 09:00 in Kuala Lumpur: 47 hours into the week, no office hour yet.
const MON_9 = at('2026-10-19T01:00:00Z')
// Fri 2026-10-23 18:00 in Kuala Lumpur: all five office days gone.
const FRI_18 = at('2026-10-23T10:00:00Z')

test('pace config: the example parses, with its defaults; a bad one is left out whole and said', () => {
  expect(GUARD.errors).toEqual([])
  expect(GUARD.rules[0]).toMatchObject({ window: 'week', stop: true, endTurn: true, groups: ['team', 'other'] })
  expect(pace).toMatchObject({ reserve: 10, burst: 8, officeWeight: 4, tz: KL, buffer: 2, tiers: [0, 3, 6], effort: 'medium', agents: 'sonnet' })
  const plain = parseGuard({ rules: [{ pace: {} }] })
  expect(plain.errors).toEqual([])
  expect(plain.rules[0]?.pace).toMatchObject({ reserve: 10, burst: 8, officeWeight: 1, buffer: 2 })
  const bad = parseGuard({ rules: [
    { pace: { reserve: 60 } },
    { pace: { burst: 95 } },
    { pace: { office: '09:99-18:00' } },
    { pace: { tiers: [3, 3, 6] } },
    { pace: { tiers: [0, 3] } },
    { pace: { turbo: 1 } },
    { pace: { tz: 'Mars/Olympus' } },
    { pace: { effort: 'turbo' } },
    { pace: { agents: 'gpt' } },
    { pace: 'yes' },
    { pace: {}, left: 10 },
    { pace: {}, window: 'day' },
    { pace: {}, stop: true },
  ] })
  expect(bad.rules).toEqual([])
  expect(bad.errors.length).toBe(13)
  expect(bad.errors.every(e => e.startsWith('rule '))).toBe(true)
  // a rule's own tz serves the pace, and the pace's wins
  expect(parseGuard({ rules: [{ pace: { office: '9-17' }, tz: KL }] }).rules[0]?.pace?.tz).toBe(KL)
  expect(parseGuard({ rules: [{ pace: { tz: 'UTC' }, tz: KL }] }).rules[0]?.pace?.tz).toBe('UTC')
})

test('the week is anchored on the reported reset, with office hours weighted: 303 weighted hours for the Malaysian week', () => {
  const cal = paceCalendar(pace, RESET_MS)
  expect(cal?.startMs).toBe(RESET_MS - 168 * HOUR)
  expect(cal?.spans.length).toBe(5)
  expect(cal?.officeMs).toBe(45 * HOUR)
  if (!cal) throw new Error('no calendar')
  expect(paceFraction(cal, cal.startMs)).toBe(0)
  near(paceFraction(cal, cal.endMs), 1)
  near(paceFraction(cal, MON_9), 47 / 303)
  near(paceFraction(cal, FRI_18), (152 + 3 * 45) / 303)
  // before the start and after the end it holds at 0 and 1
  expect(paceFraction(cal, cal.startMs - HOUR)).toBe(0)
  near(paceFraction(cal, cal.endMs + HOUR), 1)
  // monotone, and never past the room the reserve leaves
  let last = -1
  for (let t = cal.startMs; t <= cal.endMs; t += 20 * 60_000) {
    const b = paceAllowance(pace, cal, t)
    expect(b).toBeGreaterThanOrEqual(last)
    expect(b).toBeLessThanOrEqual(90)
    last = b
  }
  expect(paceAllowance(pace, cal, cal.startMs)).toBe(8)
  near(paceAllowance(pace, cal, cal.endMs), 90)
  near(paceAllowance(pace, cal, MON_9), 8 + 82 * (47 / 303))
})

test('no office hours, or a weight of 1, is a straight line; a heavier office pulls the allowance later', () => {
  const line = parseGuard({ rules: [{ pace: { reserve: 0, burst: 0 } }] }).rules[0]?.pace as Pace
  const cal = paceCalendar(line, RESET_MS)
  if (!cal) throw new Error('no calendar')
  near(paceAllowance(line, cal, cal.startMs + 84 * HOUR), 50)
  const flat = { ...pace, officeWeight: 1 }
  const flatCal = paceCalendar(flat, RESET_MS)
  if (!flatCal) throw new Error('no calendar')
  near(paceFraction(flatCal, MON_9), 47 / 168)
})

test('across daylight saving in another zone, office hours stay at the wall clock; the week stays seven days', () => {
  // New York ended daylight saving on Sun 2026-11-01. The week: Fri 2026-10-30 00:00Z to Fri 2026-11-06 00:00Z.
  const ny = parseGuard({ rules: [{ pace: { office: '09:00-17:00 mon-fri', office_weight: 3, tz: 'America/New_York', reserve: 0, burst: 0 } }] }).rules[0]?.pace as Pace
  const resetMs = at('2026-11-06T00:00:00Z')
  const cal = paceCalendar(ny, resetMs)
  if (!cal) throw new Error('no calendar')
  expect(cal.endMs - cal.startMs).toBe(168 * HOUR)
  expect(cal.spans.length).toBe(5)
  // Fri Oct 30 09:00 EDT is 13:00Z; Mon Nov 2 09:00 EST is 14:00Z.
  expect(cal.spans[0]).toEqual([at('2026-10-30T13:00:00Z'), at('2026-10-30T21:00:00Z')])
  expect(cal.spans[1]).toEqual([at('2026-11-02T14:00:00Z'), at('2026-11-02T22:00:00Z')])
  expect(cal.officeMs).toBe(40 * HOUR)
  // 168 + 2 * 40 weighted hours in all
  near(paceFraction(cal, at('2026-10-30T21:00:00Z')), (21 + 2 * 8) / 248)
  // spring forward (2026-03-08): a week from Fri 03-06 00:00Z; Mon 03-09 09:00 EDT is 13:00Z
  const spring = paceCalendar(ny, at('2026-03-13T00:00:00Z'))
  expect(spring?.spans.find(([a]) => new Date(a).getUTCDay() === 1)?.[0]).toBe(at('2026-03-09T13:00:00Z'))
})

test('a week anchored in another week gives the same allowance; a reset that is not this week\'s is no anchor', () => {
  const later = RESET_MS + 7 * 24 * HOUR
  const a = paceRead(pace, { left: 80, resetsAt: RESET }, MON_9)
  const b = paceRead(pace, { left: 80, resetsAt: later / 1000 }, MON_9 + 7 * 24 * HOUR)
  near(b?.allowed ?? -2, a?.allowed ?? -1)
  expect(b?.tier).toBe(a?.tier)
  // a reset already gone, or more than a week away, says nothing
  expect(paceRead(pace, { left: 80, resetsAt: RESET }, RESET_MS + 1000)).toBeUndefined()
  expect(paceRead(pace, { left: 80, resetsAt: later / 1000 }, MON_9)).toBeUndefined()
  expect(paceRead(pace, { left: Number.NaN, resetsAt: RESET }, MON_9)).toBeUndefined()
})

test('the tiers: effort, then cheaper agents, then stop, with two points of slack before a step lets go', () => {
  const allowed = 8 + 82 * (47 / 303)
  const tier = (used: number, was?: { tier: number; hard: boolean }) => paceRead(pace, { left: 100 - used, resetsAt: RESET }, MON_9, 0, was)?.tier
  expect(tier(15)).toBe(0)
  expect(tier(Math.ceil(allowed - 2) )).toBe(1)
  expect(tier(21)).toBe(1)
  expect(tier(23)).toBe(2)
  expect(tier(27)).toBe(3)
  // coming down: tier 1 stays until ahead is 2 under its threshold
  expect(tier(18.5, { tier: 1, hard: false })).toBe(1)
  expect(tier(16, { tier: 1, hard: false })).toBe(0)
  expect(tier(22, { tier: 3, hard: false })).toBe(2)
  // an explicit ladder
  const wide = parseGuard({ rules: [{ pace: { tiers: [4, 8, 12], buffer: 0, reserve: 0, burst: 0, office: undefined } }] }).rules[0]?.pace as Pace
  const cal = paceCalendar(wide, RESET_MS)
  if (!cal) throw new Error('no calendar')
  const t = cal.startMs + 84 * HOUR
  for (const [used, want] of [[53, 0], [54, 1], [58, 2], [62, 3]] as const) {
    expect(paceRead(wide, { left: 100 - used, resetsAt: RESET }, t)?.tier).toBe(want)
  }
})

test('the reserve itself: inside it plus the buffer, stop, however the pace stands', () => {
  const near = paceRead(pace, { left: 12, resetsAt: RESET }, FRI_18)
  expect(near).toMatchObject({ tier: 3, hard: true, liftsAt: RESET_MS })
  expect(paceRead(pace, { left: 13, resetsAt: RESET }, FRI_18)?.hard).toBe(false)
  // lets go two points past, not at once
  expect(paceRead(pace, { left: 13, resetsAt: RESET }, FRI_18, 0, { tier: 3, hard: true })?.tier).toBe(3)
  expect(paceRead(pace, { left: 15, resetsAt: RESET }, FRI_18, 0, { tier: 3, hard: true })?.hard).toBe(false)
  expect(paceWords(near as NonNullable<typeof near>)).toBe('12% of the week is left, inside the 10% g-line keeps back')
})

test('evaluate: a pace rule works through its steps for the groups it names, and says why in plain words', () => {
  const none = evaluate(GUARD, week(15, MON_9))
  expect(none.rules).toEqual([])
  const one = evaluate(GUARD, week(21, MON_9))
  expect([one.effort, one.agents, one.stop]).toEqual(['medium', undefined, undefined])
  const two = evaluate(GUARD, week(23, MON_9))
  expect([two.effort, two.agents, two.stop]).toEqual(['medium', 'sonnet', undefined])
  const three = evaluate(GUARD, week(28, MON_9))
  expect(three.stop?.pace?.tier).toBe(3)
  expect(three.end?.rule.id).toBe('r0')
  const text = stopText(three.stop as NonNullable<typeof three.stop>, MON_9, 480, false, { account: 'team@example.com' })
  expect(text).toMatch(/ahead of pace: 28% of the week used, 21% allowed by now/)
  expect(text).toMatch(/^g-line held this: team@example\.com is ahead of pace/)
  expect(text).toMatch(/Lifts about .*Enter again sends it anyway\.$/)
  // a group the rule doesn't name is left alone
  expect(evaluate(GUARD, week(28, MON_9, RESET, 'sam@example.com')).rules).toEqual([])
  // 'other' is named: an account in no group is paced
  expect(evaluate(GUARD, week(28, MON_9, RESET, 'stranger@example.com')).stop).toBeDefined()
  // no reading, no reset time, no account when the rule needs one: nothing
  expect(evaluate(GUARD, { nowMs: MON_9, account: 'team@example.com', windows: {} }).rules).toEqual([])
  expect(evaluate(GUARD, { nowMs: MON_9, account: 'team@example.com', windows: { week: { left: 10 } } }).rules).toEqual([])
  expect(evaluate(GUARD, week(28, MON_9, RESET, null)).rules).toEqual([])
  // off, or with no rules, nothing at all
  expect(evaluate({ ...GUARD, on: false }, week(28, MON_9)).rules).toEqual([])
  expect(evaluate(parseGuard({}), week(99, MON_9)).rules).toEqual([])
})

test('a pace rule can also stand on its own account, wait out hours, and wait while the reset is near', () => {
  const g: GuardConfig = parseGuard({ rules: [{ accounts: ['team@'], pace: { reserve: 10 }, unless_reset_within: '6h' }] })
  expect(g.errors).toEqual([])
  expect(evaluate(g, week(60, MON_9)).rules.length).toBe(1)
  expect(evaluate(g, week(60, MON_9, RESET, 'sam@example.com')).rules).toEqual([])
  expect(evaluate(g, week(60, RESET_MS - 5 * HOUR)).rules).toEqual([])
})

test('hysteresis remembers the account and the window: a new account or a new week starts fresh', () => {
  const v1 = evaluate(GUARD, week(21, MON_9))
  expect(v1.memory?.r0?.tier).toBe(1)
  // 18.5% used would be tier 0 afresh, but a step in force holds for two more points
  expect(evaluate(GUARD, week(18.5, MON_9), v1.active, v1.memory).rules.length).toBe(1)
  expect(evaluate(GUARD, week(18.5, MON_9), {}, {}).rules.length).toBe(0)
  // the same memory for another account, or for another window's reset, is not carried over
  expect(evaluate(GUARD, week(18.5, MON_9, RESET, 'stranger@example.com'), v1.active, v1.memory).rules.length).toBe(0)
  const nextWeek = evaluate(GUARD, week(18.5, MON_9 + 7 * 24 * HOUR, RESET + 7 * 86_400), v1.active, v1.memory)
  expect(nextWeek.rules.length).toBe(0)
})

test('when a hold lifts: the moment the allowance catches up, no later than the reset', () => {
  const v = evaluate(GUARD, week(28, MON_9))
  const stop = v.stop
  if (!stop) throw new Error('no stop')
  const lift = liftsAt(stop, MON_9, 480)
  expect(lift ?? 0).toBeGreaterThan(MON_9)
  expect(lift ?? Infinity).toBeLessThan(RESET_MS)
  // just before it, held; just after, one step lighter
  const was = { tier: 3, hard: false }
  expect(paceRead(pace, { left: 72, resetsAt: RESET }, (lift ?? 0) - 120_000, 0, was)?.tier).toBe(3)
  expect(paceRead(pace, { left: 72, resetsAt: RESET }, (lift ?? 0) + 120_000, 0, was)?.tier).toBeLessThan(3)
})

test('what the guard says: steps toast with the figures; line 2 says over pace; the rule reads in words', () => {
  const v1 = evaluate(GUARD, week(21, MON_9))
  expect(changeText(undefined, v1)).toBe('g-line guard: ahead of pace: 21% of the week used, 21% allowed by now: the conversation runs at effort medium.')
  const v2 = evaluate(GUARD, week(23, MON_9), v1.active, v1.memory)
  expect(changeText(v1, v2)).toMatch(/ahead of pace: 23% of the week used.*: new subagents run on sonnet\.$/)
  const v3 = evaluate(GUARD, week(28, MON_9), v2.active, v2.memory)
  expect(changeText(v2, v3)).toMatch(/: new prompts stop\.$/)
  expect(changeText(v3, evaluate(GUARD, week(15, MON_9)))).toMatch(/prompts go through again; effort is yours again; subagents pick their own model again/)
  expect(guardForms(v1)?.forms[0]).toBe('guard: over pace, effort medium')
  expect(guardForms(v3, undefined, '14:00')?.forms).toEqual(['guard: over pace, 28% of the week used till ~14:00', 'over pace till ~14:00', 'over pace'])
  expect(ruleText(GUARD.rules[0] as NonNullable<(typeof GUARD.rules)[0]>)).toBe(
    'paced week, on groups team, other, keeps 10% back, 8% free at the start, office Mon-Fri 09:00-18:00 Kuala Lumpur time counts 4x: '
    + 'effort medium at 0 points ahead, agents on sonnet at 3 points ahead, stop new prompts and end a running turn at 6 points ahead')
})

test('guard why: the figures, each rule, the group, the allowance now, and when the hold lifts', () => {
  const f = week(28, MON_9)
  const v = evaluate(GUARD, f)
  const lines = whyLines(GUARD, f, v).join('\n')
  expect(lines).toMatch(/Weekly window: 28% used, 72% left\. Resets Sat 10:00/)
  expect(lines).toMatch(/5-hour window: 10% used/)
  expect(lines).toMatch(/This account is in group team\./)
  expect(lines).toMatch(/28% of the week used, 21% allowed by now \(office hours\); step 3 of 3 in force/)
  expect(lines).toMatch(/Held: new prompts stop\. The hold lifts about /)
  const calm = whyLines(GUARD, week(10, MON_9), evaluate(GUARD, week(10, MON_9))).join('\n')
  expect(calm).toMatch(/10% of the week used, 21% allowed by now \(office hours\); on pace\./)
  expect(calm).toMatch(/Nothing is held now\./)
  expect(whyLines(GUARD, week(21, MON_9), evaluate(GUARD, week(21, MON_9))).join('\n')).toMatch(/In force: effort medium\. The next step eases about /)
  expect(whyLines(parseGuard({}), f, v)).toEqual(['No guard rules: write them under "guard" in config.json.'])
  const threshold = parseGuard({ rules: [{ left: 10, stop: true }] })
  expect(whyLines(threshold, { nowMs: MON_9, windows: {} }, evaluate(threshold, { nowMs: MON_9, windows: {} })).join(' ')).toMatch(/no 5-hour reading yet, so it waits/)
  // privacy: the account line itself never appears, only its group
  expect(lines).not.toMatch(/example\.com/)
})

test('epochs: a decision is bound to the account and the window it was made for', () => {
  const held = { window: 'week' as const, resetsAt: RESET }
  const a = epochOf('team@example.com (82% left)', held)
  expect(epochOf('account team@example.com (10% left)', held)).toBe(a)
  expect(epochOf('sam@example.com', held)).not.toBe(a)
  expect(epochOf('team@example.com', { ...held, resetsAt: RESET + 604_800 })).not.toBe(a)
  expect(epochOf('team@example.com', { window: '5h', resetsAt: RESET })).not.toBe(a)
  expect(epochOf(null, undefined)).toBe('machine|-')
})

test('0.12.0 validation: a malformed rule is left out whole, never half-read into a wider one', () => {
  const g = parseGuard({ rules: [
    { left: 10, stop: true, accounts: [] },
    { left: 10, stop: true, except_accounts: [''] },
    { left: 10, stop: true, window: 'month' },
    { left: 10, agents: 'not a model!' },
    { left: 10, stop: true, unless_reset_within: 'soon' },
    { left: 10, stop: true, end_turn: 'yes' },
    { left: 10, stop: true, groups: [] },
    { left: 10, stop: true, hours: '09:00-18:00 someday' },
    { left: 10, stop: true },
  ] })
  expect(g.rules.length).toBe(1)
  expect(g.rules[0]?.id).toBe('r8')
  expect(g.errors.length).toBe(8)
  // hours and numbers
  expect(parseHours('09:99-18:00')).toBeUndefined()
  expect(parseHours('25:00-26:00')).toBeUndefined()
  expect(parseHours('09:00-24:00 mon-fri')).toEqual({ from: 540, to: 1440, days: [1, 2, 3, 4, 5] })
  expect(seconds(`${'9'.repeat(400)}h`)).toBeUndefined()
  expect(tokenCount('9'.repeat(400))).toBeUndefined()
  // a rule with an unranked agent can't mask a cheaper one
  const mixed = parseGuard({ rules: [{ left: 50, agents: 'my-own-model' }, { left: 50, agents: 'haiku' }] })
  expect(evaluate(mixed, { nowMs: MON_9, windows: { '5h': { left: 40, resetsAt: Math.floor(MON_9 / 1000) + 3600 } } }).agents).toBe('haiku')
  // non-finite numbers stop deciding
  const k = KEEP_WARM_DEFAULTS
  const base: WarmFacts = { now: 10_000 + 46 * 60, lastAt: 10_000, ttl: '1h', prefix: 120_000, compacted: false, compactionCovers: false,
    done: 0, thisHour: 0, fiveHourLeft: Number.NaN, stopped: false, busy: false, jitter: 0 }
  expect(warmDue(k, base).due).toBe(false)
  expect(leaseFree({ holder: 'a', until: Number.NaN }, 'b', 1000)).toBe(true)
  expect(resumeAt([{ kind: 'five_hour', percentUsed: 100, resetsAt: Number.NaN }], 1000, 0)).toBeUndefined()
  expect(accountKey('a@example.com')).toBe('a@example.com')
})

test('a pace rule can pace the 5-hour window in office hours: the allowance grows across the five hours', () => {
  const g = parseGuard({ rules: [{ window: '5h', hours: '09:00-18:00 mon-fri', tz: KL, end_turn: true,
    pace: { reserve: 10, burst: 15, tiers: [0, 5, 10] } }] })
  expect(g.errors).toEqual([])
  const rule = g.rules[0]!
  expect(rule.window).toBe('5h')
  const reset = MON_9 / 1000 + 4 * 3600
  const five = (used: number, nowMs = MON_9, resetsAt = reset): Facts => ({ nowMs, windows: { '5h': { left: 100 - used, resetsAt } }, account: 'team@example.com', offsetMinutes: 0 })
  // An hour into the window: 15 + 75 x 1/5 = 30% allowed.
  const p = paceRead(rule.pace!, { left: 70, resetsAt: reset }, MON_9)
  near(p!.allowed, 30)
  expect(p!.window).toBe('5h')
  expect(evaluate(g, five(25)).rules).toEqual([])
  const stopped = evaluate(g, five(45))
  expect(stopped.stop?.pace?.tier).toBe(3)
  expect(paceWords(stopped.stop!.pace!)).toBe('ahead of pace: 45% of the 5-hour window used, 30% allowed by now')
  expect(guardForms(stopped, undefined, '10:30')?.forms[0]).toBe('guard: over pace, 45% of the 5h used till ~10:30')
  // It lets go well inside the window, as the allowance grows, not at the week's reset.
  expect(stopped.stop!.pace!.liftsAt! - MON_9).toBeLessThan(2 * HOUR)
  // Outside office hours the rule waits: Saturday, the same reading goes through.
  const sat = MON_9 + 5 * 24 * HOUR
  expect(evaluate(g, five(45, sat, sat / 1000 + 4 * 3600)).stop).toBeUndefined()
})

test('near the weekly reset, what is left is there to use: said with what the guard still keeps back', () => {
  const g = parseGuard({ groups: { team: ['team@'] }, drain: { within: '48h', left: 20 }, rules: [
    { groups: ['team', 'other'], window: 'week', left: 10, stop: true, unless_reset_within: '72h' },
    { groups: ['team', 'other'], window: 'week', left: 2, stop: true }] })
  expect(g.errors).toEqual([])
  const facts = (left: number, hoursToReset: number, account = 'team@example.com'): Facts =>
    ({ nowMs: MON_9, windows: { week: { left, resetsAt: MON_9 / 1000 + hoursToReset * 3600 } }, account, offsetMinutes: 0 })
  expect(drainText(g, facts(64, 40), 'team@example.com')).toMatch(/^team@example\.com has 64% of its week left, and it resets at .+\. It's yours to use: g-line keeps only the last 2%\.$/)
  // Too early, or too little left: nothing.
  expect(drainText(g, facts(64, 60))).toBeUndefined()
  expect(drainText(g, facts(15, 40))).toBeUndefined()
  // Off without the setting; true takes 48h and 20%.
  expect(drainText(parseGuard({ rules: [] }), facts(64, 40))).toBeUndefined()
  expect(parseGuard({ drain: true }).drain).toEqual({ within: 172_800, left: 20 })
  expect(parseGuard({ drain: { within: 'soon' } }).errors.length).toBe(1)
})
