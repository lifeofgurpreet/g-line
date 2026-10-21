import { expect, test } from 'claude-code/testing'

import { othersSegment, rosterOf, rosterRow, staleRosterKeys } from '../hooks/roster'
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
