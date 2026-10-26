import { expect, test } from 'claude-code/testing'

import { mergeLimits, parseUsage, othersSegment, rosterOf, rosterRow, staleRosterKeys } from '../hooks/roster'
import { parseGuard, resumeAt } from '../hooks/guard'

const NOW = Date.parse('2026-10-21T06:00:00Z')

test('the roster: fresh, well-formed heartbeats only, newest first; a day-old one is cleared', () => {
  const entries = [
    { key: 's:a', value: { at: NOW - 5000, state: 'working', since: NOW - 180_000, ctx: 41, model: 'Opus 5.5' } },
    { key: 's:b', value: { at: NOW - 1000, state: 'waiting', since: NOW - 90_000 } },
    { key: 's:gone', value: { at: NOW - 120_000, state: 'idle' } },
    { key: 's:odd', value: { at: NOW, state: 'dancing' } },
    { key: 'd:2026-10-21:x', value: { at: NOW, state: 'idle' } },
    { key: 's:ancient', value: { at: NOW - 2 * 86_400_000, state: 'idle' } },
  ]
  expect(rosterOf(entries, NOW).map(e => e.id)).toEqual(['b', 'a'])
  expect(staleRosterKeys(entries, NOW)).toEqual(['s:ancient'])
})

test('line 2 says others only when there are some, and which wait on you', () => {
  expect(othersSegment([])).toBeUndefined()
  const idle = { id: 'a', at: NOW, state: 'idle' as const, since: NOW }
  expect(othersSegment([idle])).toEqual({ key: 'others', priority: 30, forms: ['1 other'] })
  expect(othersSegment([idle, { ...idle, id: 'b', state: 'waiting' }])).toEqual({ key: 'others', priority: 38, tone: 'warn', forms: ['2 others · 1 waiting', '1 waiting'] })
})

test('a pane row: what it does and for how long, context, cache, model, account', () => {
  expect(rosterRow({ id: 'a', at: NOW, state: 'working', since: NOW - 180_000, ctx: 41.4, cacheUntil: NOW / 1000 + 2520, model: 'Opus 5.5', account: 'team@example.com' }, NOW, false))
    .toBe('working 3m · ctx 41% · cache ~42m · Opus 5.5 · team@example.com')
  expect(rosterRow({ id: 'b', at: NOW, state: 'waiting', since: NOW - 30_000, cacheUntil: NOW / 1000 - 10 }, NOW, true))
    .toBe('waiting on you <1m (this one) · cache cold')
})

test('resume: after the latest reset of every full window, plus the jitter; nothing when no window is full', () => {
  const s = Math.floor(NOW / 1000)
  expect(resumeAt([{ kind: 'five_hour', percentUsed: 100, resetsAt: s + 3600 }], NOW, 120)).toEqual({ at: (s + 3600 + 120) * 1000, window: '5h' })
  expect(resumeAt([{ kind: 'five_hour', percentUsed: 100, resetsAt: s + 3600 }, { kind: 'seven_day', percentUsed: 100, resetsAt: s + 86_400 }], NOW, 0))
    .toEqual({ at: (s + 86_400) * 1000, window: 'week' })
  expect(resumeAt([{ kind: 'five_hour', percentUsed: 97, resetsAt: s + 3600 }], NOW, 0)).toBeUndefined()
  expect(resumeAt([{ kind: 'five_hour', percentUsed: 100 }], NOW, 0)).toBeUndefined()
  expect(resumeAt([{ kind: 'five_hour', percentUsed: 100, resetsAt: s - 60 }], NOW, 0)).toBeUndefined()
  expect(parseGuard({ resume: true }).resume).toEqual({ text: 'continue', jitter: 300 })
  expect(parseGuard({ resume: { text: 'Carry on with the plan.', jitter: '2m' } }).resume).toEqual({ text: 'Carry on with the plan.', jitter: 120 })
  expect(parseGuard({}).resume).toBeUndefined()
})

test('sessions on one account share usage: the higher percent in the same window, the later window across a reset', async () => {
  const now = 1_000_000
  const own = [{ kind: 'five_hour', percentUsed: 84, resetsAt: now + 3600 }, { kind: 'seven_day', percentUsed: 29, resetsAt: now + 86_400 }]
  expect(mergeLimits(own, [{ kind: 'five_hour', percentUsed: 88, resetsAt: now + 3600.6 }], now))
    .toEqual([{ kind: 'five_hour', percentUsed: 88, resetsAt: now + 3600 }, own[1]])
  // A lower shared reading in the same window changes nothing; order doesn't matter.
  expect(mergeLimits(own, [{ kind: 'five_hour', percentUsed: 80, resetsAt: now + 3600 }], now)).toEqual(own)
  // After a reset the newer window wins; a shared window already past its reset is ignored.
  expect(mergeLimits(own, [{ kind: 'five_hour', percentUsed: 3, resetsAt: now + 5 * 3600 }], now)[0]?.percentUsed).toBe(3)
  expect(mergeLimits([{ kind: 'five_hour', percentUsed: 3, resetsAt: now + 5 * 3600 }], [{ kind: 'five_hour', percentUsed: 90, resetsAt: now - 10 }], now)[0]?.percentUsed).toBe(3)
  // Junk from the store is skipped; a window only the other session saw is taken.
  expect(mergeLimits(own, 'junk', now)).toEqual(own)
  expect(mergeLimits([], [{ kind: 'seven_day', percentUsed: 40, resetsAt: now + 100 }, { kind: 1 }], now)).toEqual([{ kind: 'seven_day', percentUsed: 40, resetsAt: now + 100 }])
})

test('in the same window the newest observation wins, so a stale or wrong figure heals', () => {
  const now = 1_000_000
  const w = now + 86_400
  // A newer, lower reading replaces an older, higher one: a figure that was wrong, or a reset given early.
  expect(mergeLimits([{ kind: 'seven_day', percentUsed: 21, resetsAt: w, at: now }], [{ kind: 'seven_day', percentUsed: 100, resetsAt: w, at: now - 3600 }], now))
    .toEqual([{ kind: 'seven_day', percentUsed: 21, resetsAt: w, at: now }])
  // A newer shared reading replaces this session's older one.
  expect(mergeLimits([{ kind: 'seven_day', percentUsed: 30, resetsAt: w, at: now - 600 }], [{ kind: 'seven_day', percentUsed: 33, resetsAt: w, at: now }], now))
    .toEqual([{ kind: 'seven_day', percentUsed: 33, resetsAt: w, at: now }])
  // A timed reading beats an untimed one from before 0.19.1, whichever side it's on.
  expect(mergeLimits([{ kind: 'seven_day', percentUsed: 21, resetsAt: w, at: now }], [{ kind: 'seven_day', percentUsed: 100, resetsAt: w }], now)[0]?.percentUsed).toBe(21)
  expect(mergeLimits([{ kind: 'seven_day', percentUsed: 100, resetsAt: w }], [{ kind: 'seven_day', percentUsed: 21, resetsAt: w, at: now }], now)[0]?.percentUsed).toBe(21)
  // The same time: the higher percent. A time that isn't a number counts as none.
  expect(mergeLimits([{ kind: 'five_hour', percentUsed: 10, resetsAt: w, at: now }], [{ kind: 'five_hour', percentUsed: 12, resetsAt: w, at: now }], now)[0]?.percentUsed).toBe(12)
  expect(mergeLimits([{ kind: 'seven_day', percentUsed: 21, resetsAt: w, at: now }], [{ kind: 'seven_day', percentUsed: 90, resetsAt: w, at: 'soon' }], now)[0]?.percentUsed).toBe(21)
})

test('parseUsage takes a window\'s observed_at, or the time the command ran', () => {
  const line = '{"seven_day":{"used_percentage":21,"resets_at":"2026-10-28T00:00:00Z","observed_at":"2026-10-26T02:56:48.625Z"}}'
  expect(parseUsage(line, 1)).toEqual([{ kind: 'seven_day', percentUsed: 21,
    resetsAt: Date.parse('2026-10-28T00:00:00Z') / 1000, at: Math.floor(Date.parse('2026-10-26T02:56:48.625Z') / 1000) }])
  expect(parseUsage('{"seven_day":{"used_percentage":21,"resets_at":"2026-10-28T00:00:00Z"}}', 1234)?.[0]?.at).toBe(1234)
})

test('parseUsage reads the first line as JSON and nothing else', () => {
  const line = '{"five_hour":{"used_percentage":42.5,"resets_at":"2026-10-23T12:00:00Z"},"seven_day":{"used_percentage":70,"resets_at":"2026-10-27T00:00:00Z"}}'
  expect(parseUsage(line + '\nignored')).toEqual([
    { kind: 'five_hour', percentUsed: 42.5, resetsAt: Date.parse('2026-10-23T12:00:00Z') / 1000 },
    { kind: 'seven_day', percentUsed: 70, resetsAt: Date.parse('2026-10-27T00:00:00Z') / 1000 },
  ])
  expect(parseUsage('not json')).toBeUndefined()
  expect(parseUsage('')).toBeUndefined()
  expect(parseUsage('{"five_hour":{"used_percentage":"9","resets_at":"2026-10-23T12:00:00Z"}}')).toBeUndefined()
  expect(parseUsage('{"five_hour":{"used_percentage":9,"resets_at":"soon"}}')).toBeUndefined()
})
