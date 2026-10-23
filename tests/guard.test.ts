import { expect, test } from 'claude-code/testing'

import {
  KEEP_WARM_DEFAULTS, accountIdentity, accountKey, agentModel, cappedEffort, changeText, effortKeepsCache, bridgeDue, endText, evaluate, groupOf, hoursWords, liftsAt, guardForms, inHours, leaseFree,
  localTime, parseGuard, parseHours, readBack, ruleText, seconds, simulated, stopText, tokenCount, warmDue, warmForms,
} from '../hooks/guard'
import type { Facts, WarmFacts } from '../hooks/guard'

// The operator's rules from the README, with a neutral shared account.
const RULES = parseGuard({
  rules: [
    { left: 20, effort: 'medium' },
    { left: 10, agents: 'sonnet' },
    { left: 5, stop: true, unless_reset_within: '1h' },
    { left: 10, stop: true, accounts: ['team@'], hours: '09:00-17:00 mon-fri', tz: 'Asia/Kuala_Lumpur' },
  ],
  keep_warm: { after: '45m', max: 2, min_context: '50k' },
})

// Tuesday 2026-10-20, 10:00 in Kuala Lumpur (UTC+8).
const TUE_10_KL = Date.parse('2026-10-20T02:00:00Z')
const HOUR = 3600

function facts(left: number, o: { now?: number; resetsIn?: number | null; account?: string | null; week?: number } = {}): Facts {
  const nowMs = o.now ?? TUE_10_KL
  const resetsAt = o.resetsIn === null ? undefined : Math.floor(nowMs / 1000) + (o.resetsIn ?? 3 * HOUR)
  return {
    nowMs, account: o.account === undefined ? 'solo@example.com' : o.account,
    windows: { '5h': { left, resetsAt }, ...(o.week !== undefined ? { week: { left: o.week, resetsAt: Math.floor(nowMs / 1000) + 4 * 86_400 } } : {}) },
  }
}

test('the README\'s rules parse; nothing is in force without rules, and a malformed rule is said, not guessed', () => {
  expect(RULES.errors).toEqual([])
  expect(RULES.rules.map(r => r.id)).toEqual(['r0', 'r1', 'r2', 'r3'])
  expect(RULES.rules[3]?.hours).toEqual({ from: 540, to: 1020, days: [1, 2, 3, 4, 5] })
  expect(RULES.keepWarm).toEqual({ ...KEEP_WARM_DEFAULTS, after: 2700, max: 2, minContext: 50_000 })
  const none = parseGuard(undefined)
  expect(evaluate(none, facts(1)).rules).toEqual([])
  const bad = parseGuard({ rules: [{ left: 120, stop: true }, { left: 10 }, { left: 10, stop: true, tz: 'Mars/Olympus' }, { left: 10, effort: 'turbo', stop: true }] })
  expect(bad.rules.map(r => r.id)).toEqual(['r3'])
  expect(bad.errors.length).toBe(4)
  expect(parseGuard({ keep_warm: true }).keepWarm).toEqual(KEEP_WARM_DEFAULTS)
  // keep-warm's timing is held to 10-55 minutes, and at most 6 re-reads.
  expect(parseGuard({ keep_warm: { after: '2m', max: 50 } }).keepWarm).toEqual({ ...KEEP_WARM_DEFAULTS, after: 600, max: 6 })
  expect(parseGuard(false).on).toBe(false)
})

test('thresholds: each rule acts at its percent left and below, the strictest action wins', () => {
  expect(evaluate(RULES, facts(21)).rules).toEqual([])
  const at20 = evaluate(RULES, facts(20))
  expect(at20.effort).toBe('medium')
  expect(at20.agents).toBeUndefined()
  const at9 = evaluate(RULES, facts(9))
  expect([at9.effort, at9.agents, at9.stop]).toEqual(['medium', 'sonnet', undefined])
  const at4 = evaluate(RULES, facts(4))
  expect(at4.stop?.rule.id).toBe('r2')
  expect(evaluate(parseGuard({ rules: [{ left: 30, effort: 'high' }, { left: 20, effort: 'low' }] }), facts(10)).effort).toBe('low')
})

test('hysteresis: a rule in force lets go only 2 points past its threshold, or when the window resets', () => {
  const on = evaluate(RULES, facts(20))
  expect(evaluate(RULES, facts(21), on.active).effort).toBe('medium')
  expect(evaluate(RULES, facts(22), on.active).effort).toBe('medium')
  expect(evaluate(RULES, facts(22.5), on.active).effort).toBeUndefined()
  // A new window (its reset moved) starts over: 21% there is above the threshold.
  expect(evaluate(RULES, facts(21, { resetsIn: 5 * HOUR }), on.active).effort).toBeUndefined()
})

test('a stop waits while the window resets within the hour; with no reset time it does nothing', () => {
  expect(evaluate(RULES, facts(4, { resetsIn: 30 * 60 })).stop).toBeUndefined()
  expect(evaluate(RULES, facts(4, { resetsIn: 61 * 60 })).stop?.rule.id).toBe('r2')
  expect(evaluate(RULES, facts(4, { resetsIn: null })).stop).toBeUndefined()
})

test('a shared-account rule: only that account, only in office hours in its own time zone', () => {
  const team = { account: 'team@example.com (via CAAM)' }
  expect(evaluate(RULES, facts(9, team)).stop?.rule.id).toBe('r3')
  expect(evaluate(RULES, facts(9, { account: 'TEAM@example.com' })).stop?.rule.id).toBe('r3')
  expect(evaluate(RULES, facts(9)).stop).toBeUndefined()
  // No account reading: the rule waits.
  expect(evaluate(RULES, facts(9, { account: null })).stop).toBeUndefined()
  // 18:00 in Kuala Lumpur, and Saturday 10:00 there: out of hours.
  expect(evaluate(RULES, facts(9, { ...team, now: Date.parse('2026-10-20T10:00:00Z') })).stop).toBeUndefined()
  expect(evaluate(RULES, facts(9, { ...team, now: Date.parse('2026-10-24T02:00:00Z') })).stop).toBeUndefined()
  // Monday 09:00 sharp is in; 08:59 is out, even though it's Sunday evening in UTC.
  expect(evaluate(RULES, facts(9, { ...team, now: Date.parse('2026-10-19T01:00:00Z') })).stop?.rule.id).toBe('r3')
  expect(evaluate(RULES, facts(9, { ...team, now: Date.parse('2026-10-19T00:59:00Z') })).stop).toBeUndefined()
  // Leaving the account lets go at once, hysteresis or not.
  const on = evaluate(RULES, facts(9, team))
  expect(evaluate(RULES, facts(9), on.active).stop).toBeUndefined()
})

test('0.8.2: a rule for every account but yours, on the weekly window as well as the 5-hour one', () => {
  const g = parseGuard({
    rules: [
      { left: 10, stop: true, except_accounts: ['me@'], hours: '09:00-17:00 mon-fri', tz: 'Asia/Kuala_Lumpur' },
      { left: 10, window: 'week', stop: true, except_accounts: 'me@', unless_reset_within: '1h' },
    ],
  })
  expect(g.errors).toEqual([])
  const shared = { account: 'account team@example.com (via CAAM)' }
  // A shared account in office hours: the 5-hour reserve holds.
  expect(evaluate(g, facts(9, shared)).stop?.rule.id).toBe('r0')
  // Your own account (any case) is left out; no account reading decides nothing.
  expect(evaluate(g, facts(9, { account: 'ME@example.com' })).stop).toBeUndefined()
  expect(evaluate(g, facts(9, { account: null })).stop).toBeUndefined()
  // The weekly reserve holds out of hours too (Saturday 10:00 in Kuala Lumpur), not on your own account.
  const sat = Date.parse('2026-10-24T02:00:00Z')
  expect(evaluate(g, facts(80, { ...shared, week: 8, now: sat })).stop?.rule.id).toBe('r1')
  expect(evaluate(g, facts(80, { account: 'me@example.com', week: 8, now: sat })).stop).toBeUndefined()
  expect(stopText(evaluate(g, facts(80, { ...shared, week: 8 })).stop!, TUE_10_KL, 480, false, { account: shared.account }))
    .toBe('g-line held this prompt: team@example.com is a team seat, with 8% of its weekly window left. g-line keeps the last 10% of it for the team. It resets at Sat 10:00, in 4d 0h. Press Enter again to send it anyway, or /g-line guard pause for an hour.')
  expect(ruleText(g.rules[1]!)).toBe('at 10% of week left, unless it resets within 60m, on accounts except "me@": stop new prompts')
  expect(parseGuard({ rules: [{ left: 10, stop: true, except_accounts: [] }] }).errors.length).toBe(1)
})

test('0.9.0: end_turn goes with a stop, is said in the rule, and marks the verdict', () => {
  const g = parseGuard({ rules: [{ left: 10, stop: true, end_turn: true, except_accounts: ['me@'] }, { left: 20, effort: 'low', end_turn: true }] })
  expect(g.errors).toEqual(['rule 2: "end_turn" goes with "stop": true'])
  expect(g.rules[0]?.endTurn).toBe(true)
  expect(g.rules[1]?.endTurn).toBeUndefined()
  expect(ruleText(g.rules[0]!)).toBe('at 10% of 5h left, on accounts except "me@": stop new prompts and end a running turn')
  const v = evaluate(g, facts(9, { account: 'team@example.com' }))
  expect([v.stop?.rule.id, v.end?.rule.id]).toEqual(['r0', 'r0'])
  expect(evaluate(g, facts(9, { account: 'me@example.com' })).end).toBeUndefined()
  // A plain stop never ends a turn.
  expect(evaluate(RULES, facts(4)).end).toBeUndefined()
  expect(endText(v.end!, TUE_10_KL, 480)).toBe('g-line ended this turn before its next request: this account is a team seat, with 9% of its 5-hour window left. g-line keeps the last 10% of it for the team. It resets at 13:00, in 3h 0m. To carry on anyway, type "continue" and press Enter twice.')
})

test('0.9.1: account groups: an account is in the first group that names it, or "other"; rules name groups', () => {
  const g = parseGuard({
    groups: {
      mine: ['me@'],
      team: { accounts: ['team@', 'ops@'], for: 'the team' },
      people: { accounts: 'sam@', for: 'its owner' },
    },
    rules: [
      { left: 10, stop: true, end_turn: true, groups: ['team'], hours: '04:00-17:00 mon-fri', tz: 'Asia/Kuala_Lumpur' },
      { left: 40, stop: true, groups: ['people'] },
      { left: 15, stop: true, group: 'other' },
      { left: 10, stop: true, groups: ['nobody'] },
    ],
  })
  expect(g.errors).toEqual(['rule 4: no group named "nobody" in "guard.groups"'])
  expect(g.groups?.map(x => [x.name, x.keepFor])).toEqual([['mine', 'the mine group'], ['team', 'the team'], ['people', 'its owner']])
  expect(groupOf(g.groups, 'account SAM@example.com (via CAAM)')?.name).toBe('people')
  expect(groupOf(g.groups, 'account stranger@example.com')?.name).toBe('other')
  expect(groupOf(g.groups, null)).toBeUndefined()
  // A person's own seat keeps most of its window; the team seat only its last 10% in office hours.
  const sam = evaluate(g, facts(35, { account: 'account sam@example.com (via CAAM)' }))
  expect([sam.stop?.rule.id, sam.stop?.group?.name]).toEqual(['r1', 'people'])
  expect(stopText(sam.stop!, TUE_10_KL, 480, false, { account: 'account sam@example.com (via CAAM)' }))
    .toBe('g-line held this prompt: sam@example.com is in your people group, with 35% of its 5-hour window left. g-line keeps the last 40% of it for its owner. It resets at 13:00, in 3h 0m. Press Enter again to send it anyway, or /g-line guard pause for an hour.')
  const team = evaluate(g, facts(9, { account: 'ops@example.com' }))
  expect(stopText(team.stop!, TUE_10_KL, 480, false, { account: 'ops@example.com', typed: false }))
    .toBe('g-line held this prompt: ops@example.com is in your team group, with 9% of its 5-hour window left. Mon-Fri 04:00-17:00 Kuala Lumpur time, g-line keeps the last 10% of it for the team. It resets at 13:00, in 3h 0m. /g-line guard pause lets prompts like this through for an hour.')
  expect(guardForms(team, 0, '13:00')?.forms).toEqual(['guard: team reserve, 9% 5h left till 13:00', 'team reserve till 13:00', 'team reserve'])
  expect(evaluate(g, facts(9, { account: 'me@example.com' })).stop).toBeUndefined()
  expect(evaluate(g, facts(12, { account: 'stranger@example.com' })).stop?.group?.name).toBe('other')
  expect(ruleText(g.rules[0]!)).toBe('at 10% of 5h left, on group team, 04:00-17:00 Mon,Tue,Wed,Thu,Fri (Asia/Kuala_Lumpur): stop new prompts and end a running turn')
  expect(parseGuard({ groups: { other: ['x@'] } }).errors.length).toBe(1)
  expect(hoursWords(g.rules[0]!)).toBe('Mon-Fri 04:00-17:00 Kuala Lumpur time')
})

test('0.9.1: with several stops in force, the reason stays the one that started first', () => {
  const g = parseGuard({ rules: [
    { left: 5, stop: true },
    { left: 10, stop: true, except_accounts: ['me@'] },
  ] })
  const at9 = evaluate(g, facts(9, { account: 'team@example.com' }))
  const at4 = evaluate(g, facts(4, { account: 'team@example.com' }))
  expect([at9.stop?.rule.id, at4.stop?.rule.id]).toEqual(['r1', 'r1'])
  // A more depleted window still gives the reason.
  const week = parseGuard({ rules: [{ left: 10, stop: true }, { left: 20, window: 'week', stop: true }] })
  expect(evaluate(week, facts(9, { week: 3 })).stop?.window).toBe('week')
})

test('0.11.0: when a stop lets go, and when a queued prompt needs its cache kept warm', () => {
  const g = parseGuard({ rules: [
    { left: 10, stop: true, hours: '04:00-17:00 mon-fri', tz: 'Asia/Kuala_Lumpur' },
    { left: 10, stop: true },
  ] })
  // Tuesday 10:00 in Kuala Lumpur: the hours end at 17:00, before a reset 9 hours out.
  const hoursRule = evaluate({ ...g, rules: [g.rules[0]!] }, facts(9, { resetsIn: 9 * HOUR })).stop!
  expect(liftsAt(hoursRule, TUE_10_KL)).toBe(TUE_10_KL + 7 * HOUR * 1000)
  const plainRule = evaluate({ ...g, rules: [g.rules[1]!] }, facts(9, { resetsIn: 2 * HOUR })).stop!
  expect(liftsAt(plainRule, TUE_10_KL)).toBe(TUE_10_KL + 2 * HOUR * 1000)
  const now = 1_000_000
  const base = { now, expiresAt: now + 200, sendAt: now + 3600, left: 5, bridges: 0, prefix: 90_000 }
  expect(bridgeDue(base)).toBe(true)
  expect(bridgeDue({ ...base, expiresAt: now + 600 })).toBe(false)
  expect(bridgeDue({ ...base, sendAt: now + 100 })).toBe(false)
  expect(bridgeDue({ ...base, left: 0 })).toBe(false)
  expect(bridgeDue({ ...base, bridges: 2 })).toBe(false)
  expect(bridgeDue({ ...base, prefix: 5_000 })).toBe(false)
  expect(bridgeDue({ ...base, expiresAt: undefined })).toBe(false)
  expect(stopText(plainRule, TUE_10_KL, 480, false, { queued: { at: '12:00', cache: 'bridge' } }))
    .toBe('g-line held this prompt: 9% of the 5-hour window left, at or under your 10% stop. It resets at 12:00, in 2h 0m. g-line will send it when the guard lets it through, about 12:00, keeping the cache warm until then. Enter again sends it now; /g-line guard cancel keeps it here.')
  expect(parseGuard({ queue: true }).queue).toBe(true)
  expect(parseGuard({}).queue).toBeUndefined()
})

test('time windows: day lists and ranges, past midnight, and the machine\'s own zone when none is named', () => {
  expect(parseHours('9-17 sat,sun')).toEqual({ from: 540, to: 1020, days: [0, 6] })
  expect(parseHours('22:00-06:00')).toEqual({ from: 1320, to: 360, days: [0, 1, 2, 3, 4, 5, 6] })
  expect(parseHours('fri-mon 10:00')).toBeUndefined()
  const night = parseHours('22:00-06:00 fri')!
  expect(inHours(night, { day: 5, minute: 23 * 60 })).toBe(true)
  expect(inHours(night, { day: 6, minute: 5 * 60 })).toBe(true)
  expect(inHours(night, { day: 6, minute: 23 * 60 })).toBe(false)
  expect(localTime(TUE_10_KL, 'Asia/Kuala_Lumpur')).toEqual({ day: 2, minute: 600 })
  expect(localTime(TUE_10_KL, undefined, 8 * 60)).toEqual({ day: 2, minute: 600 })
  expect(localTime(TUE_10_KL, 'Nowhere/Else')).toBeUndefined()
})

test('a rule can watch the weekly window instead', () => {
  const week = parseGuard({ rules: [{ left: 15, window: 'week', effort: 'low' }] })
  expect(evaluate(week, facts(80, { week: 10 })).effort).toBe('low')
  expect(evaluate(week, facts(5, { week: 40 })).effort).toBeUndefined()
  expect(evaluate(week, facts(5)).effort).toBeUndefined()
})

test('missing figures decide nothing', () => {
  expect(evaluate(RULES, { nowMs: TUE_10_KL, windows: {} }).rules).toEqual([])
  expect(evaluate(RULES, { nowMs: TUE_10_KL, windows: { '5h': { left: Number.NaN } } }).rules).toEqual([])
  expect(evaluate({ ...RULES, on: false }, facts(1)).rules).toEqual([])
})

test('effort only ever goes down, and keeps the cache only where Claude Code says it does', () => {
  expect(cappedEffort('xhigh', 'medium')).toBe('medium')
  expect(cappedEffort('medium', 'medium')).toBeUndefined()
  expect(cappedEffort('low', 'medium')).toBeUndefined()
  expect(cappedEffort(3, 'medium')).toBeUndefined()
  expect(cappedEffort('high', undefined)).toBeUndefined()
  expect(effortKeepsCache('claude-opus-5-5[1m]', {})).toBe(true)
  expect(effortKeepsCache('claude-fable-5-1', {})).toBe(true)
  expect(effortKeepsCache('claude-opus-5', {})).toBe(false)
  expect(effortKeepsCache('claude-opus-5-5', { bedrock: true })).toBe(false)
  expect(effortKeepsCache('claude-sonnet-5-5', { noBetas: true })).toBe(false)
})

test('a subagent moves only to a cheaper model: never a fork, never up', () => {
  // A general-purpose agent runs on its parent's model, here Opus.
  const spawn = { known: 'claude-opus-5-5', fork: false }
  expect(agentModel('sonnet', spawn)).toBe('sonnet')
  expect(agentModel('sonnet', { ...spawn, model: 'opus' })).toBe('sonnet')
  expect(agentModel('sonnet', { ...spawn, model: 'haiku' })).toBeUndefined()
  expect(agentModel('sonnet', { ...spawn, known: 'claude-haiku-5-5' })).toBeUndefined()
  expect(agentModel('sonnet', { ...spawn, fork: true })).toBeUndefined()
  expect(agentModel('sonnet', { ...spawn, known: 'claude-sonnet-5-5' })).toBeUndefined()
  // A type whose own definition picks its model (a plugin's agent pinned to Haiku, say) is left alone: never moved up.
  expect(agentModel('sonnet', { fork: false })).toBeUndefined()
  expect(agentModel('mystery', spawn)).toBeUndefined()
  expect(agentModel(undefined, spawn)).toBeUndefined()
})

test('what the guard says: the stop, what started and ended, line 2', () => {
  const stop = evaluate(RULES, facts(4))
  const text = stopText(stop.stop!, TUE_10_KL, 8 * 60)
  expect(text).toBe('g-line held this prompt: 4% of the 5-hour window left, at or under your 5% stop. It resets at 13:00, in 3h 0m. Press Enter again to send it anyway, or /g-line guard pause for an hour.')
  expect(changeText(undefined, evaluate(RULES, facts(20)))).toBe('g-line guard: the conversation runs at effort medium.')
  expect(changeText(evaluate(RULES, facts(20)), stop)).toBe('g-line guard: new prompts stop (4% of the 5-hour window left); new subagents run on sonnet.')
  expect(changeText(stop, evaluate(RULES, facts(90, { resetsIn: 5 * HOUR }), stop.active)))
    .toBe('g-line guard: prompts go through again; effort is yours again; subagents pick their own model again.')
  expect(changeText(stop, stop)).toBeUndefined()
  expect(guardForms(stop)).toEqual({ forms: ['guard: held, 4% 5h left', 'guard: held', 'guard: held'], tone: 'bad' })
  expect(guardForms(stop, 0, '13:00')?.forms).toEqual(['guard: held, 4% 5h left till 13:00', 'guard: held till 13:00', 'guard: held'])
  expect(guardForms(evaluate(RULES, facts(9)))).toEqual({ forms: ['guard: effort medium, agents sonnet', 'guard on'], tone: 'warn' })
  expect(guardForms(stop, 1800)).toEqual({ forms: ['guard paused 30m', 'guard paused'], tone: 'dim' })
  expect(guardForms(evaluate(RULES, facts(50)))).toBeUndefined()
  expect(ruleText(RULES.rules[3]!)).toBe('at 10% of 5h left, on accounts "team@", 09:00-17:00 Mon,Tue,Wed,Thu,Fri (Asia/Kuala_Lumpur): stop new prompts')
  expect(ruleText(RULES.rules[2]!)).toBe('at 5% of 5h left, unless it resets within 60m: stop new prompts')
})

test('keep-warm: only an idle, warm, hour-long cache worth keeping, a bounded number of times', () => {
  const k = RULES.keepWarm
  const base: WarmFacts = { now: 10_000 + 46 * 60, lastAt: 10_000, ttl: '1h', prefix: 120_000, compacted: false, compactionCovers: false,
    done: 0, thisHour: 0, fiveHourLeft: 60, stopped: false, busy: false, jitter: 0 }
  expect(warmDue(k, base).due).toBe(true)
  expect(warmDue(undefined, base).due).toBe(false)
  expect(warmDue(k, { ...base, now: 10_000 + 40 * 60 }).why).toBe('not idle long enough')
  expect(warmDue(k, { ...base, jitter: 120 }).why).toBe('not idle long enough')
  expect(warmDue(k, { ...base, now: 10_000 + 59 * 60 }).why).toBe('the cache has lapsed')
  // The latest `after` (55 minutes) plus the most spread (3 minutes) still leaves a minute to re-read in.
  const late = { ...k!, after: 55 * 60 }
  expect(warmDue(late, { ...base, now: 10_000 + 57 * 60, jitter: 179 }).due).toBe(true)
  expect(warmDue(k, { ...base, ttl: '5m' }).due).toBe(false)
  expect(warmDue(k, { ...base, prefix: 30_000 }).due).toBe(false)
  expect(warmDue(k, { ...base, compactionCovers: true }).why).toBe('Claude Code compacts this conversation when idle')
  expect(warmDue(k, { ...base, compacted: true }).due).toBe(false)
  expect(warmDue(k, { ...base, done: 2 }).due).toBe(false)
  expect(warmDue(k, { ...base, thisHour: 6 }).due).toBe(false)
  expect(warmDue(k, { ...base, stopped: true }).due).toBe(false)
  expect(warmDue(k, { ...base, fiveHourLeft: 10 }).due).toBe(false)
  expect(warmDue(k, { ...base, fiveHourLeft: undefined }).due).toBe(false)
  expect(warmDue(k, { ...base, busy: true }).due).toBe(false)
})

test('times and sizes as people write them', () => {
  expect([seconds('45m'), seconds('1h'), seconds('1h30m'), seconds('90s'), seconds(30), seconds('soon')]).toEqual([2700, 3600, 5400, 90, 1800, undefined])
  expect([tokenCount('50k'), tokenCount('1.5m'), tokenCount(2000), tokenCount('lots')]).toEqual([50_000, 1_500_000, 2000, undefined])
})

test('0.7.1: a reading from before the window reset decides nothing; re-reads, leases and the account\'s share', () => {
  // The 5-hour window reset ten minutes ago, but the last reading (96% used) is from before it.
  const stale: Facts = { nowMs: TUE_10_KL, windows: { '5h': { left: 4, resetsAt: Math.floor(TUE_10_KL / 1000) - 600 } } }
  expect(evaluate(RULES, stale).rules).toEqual([])
  expect(readBack(100_000, { cache_read_input_tokens: 100_000, cache_creation_input_tokens: 2000 })).toBe(true)
  expect(readBack(100_000, { cache_read_input_tokens: 0, cache_creation_input_tokens: 100_000 })).toBe(false)
  expect(readBack(100_000, { cache_read_input_tokens: 90_000, cache_creation_input_tokens: 9000 })).toBe(false)
  expect(readBack(100_000, undefined)).toBe(false)
  expect(accountKey('Team@Example.com (via manager)')).toBe('team@example.com')
  // A note that changes while the account stays (its quota, its plan) doesn't make it another account.
  expect(accountKey('account team@example.com (82% left)')).toBe(accountKey('team@example.com (79% left)'))
  expect(accountIdentity('account team@example.com (Max)')).toBe('team@example.com')
  expect(accountKey(null)).toBe('machine')
  expect(leaseFree(undefined, 's1', 0)).toBe(true)
  expect(leaseFree({ holder: 's2', until: 5000 }, 's1', 1000)).toBe(false)
  expect(leaseFree({ holder: 's2', until: 5000 }, 's1', 6000)).toBe(true)
  expect(leaseFree({ holder: 's1', until: 5000 }, 's1', 1000)).toBe(true)
  expect(warmForms(2, 0.18)).toEqual(['kept warm 2× · $0.18', 'kept warm 2×'])
  expect(warmForms(1)).toEqual(['kept warm 1×'])
  expect(warmForms(0)).toEqual([])
})

test('0.7.1: keep-warm stands down after an account or model change, and keeps only the last-typed session per account', () => {
  const k = RULES.keepWarm!
  const base: WarmFacts = { now: 10_000 + 46 * 60, lastAt: 10_000, ttl: '1h', prefix: 120_000, compacted: false, compactionCovers: false,
    done: 0, thisHour: 0, fiveHourLeft: 60, stopped: false, busy: false, jitter: 0 }
  expect(warmDue(k, { ...base, accountChanged: true }).why).toBe('the account changed')
  expect(warmDue(k, { ...base, modelChanged: true }).why).toBe('the model changed')
  expect(warmDue(k, { ...base, notLastTouched: true }).why).toBe('you typed in another session on this account last')
  expect(warmDue({ ...k, sessions: 'all' }, { ...base, notLastTouched: true }).due).toBe(true)
  expect(warmDue(k, { ...base, leased: true }).why).toBe('another session on this account is re-reading')
  expect(parseGuard({ keep_warm: { sessions: 'all' } }).keepWarm?.sessions).toBe('all')
})

test('0.7.1: a simulated reading replaces one window for the guard alone, for a while', () => {
  const f = facts(60)
  const sim = simulated(f, { window: '5h', used: 96, until: TUE_10_KL + 60_000 })
  expect(sim.windows['5h']?.left).toBe(4)
  expect(sim.windows['5h']?.resetsAt).toBe(f.windows['5h']?.resetsAt)
  expect(evaluate(RULES, sim).stop?.rule.id).toBe('r2')
  expect(simulated(f, { window: '5h', used: 96, until: TUE_10_KL - 1 })).toBe(f)
  const none = simulated({ nowMs: TUE_10_KL, windows: {} }, { window: 'week', used: 90, until: TUE_10_KL + 1 })
  expect(none.windows.week).toEqual({ left: 10, resetsAt: Math.floor(TUE_10_KL / 1000) + 7200 })
})
