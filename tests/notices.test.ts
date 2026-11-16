import { expect, test } from 'claude-code/testing'

import { deck, nextRoom, nextRows } from '../hooks/deck'
import { width } from '../hooks/core'
import type { Payload } from '../hooks/core'
import { accountSegment, joined, tailRoom } from '../hooks/inline'
import { inForce, keepsLast, noticeRows, noticeSegment, parseNotices, readNotices, runFailure, toastFor, toastsDue, toastText } from '../hooks/notices'
import { clean } from '../hooks/pulse'
import { merge, DEFAULTS, parseCommand } from '../hooks/settings'

const ESC = String.fromCharCode(27)
const NOW = Date.UTC(2026, 10, 11, 2, 0) / 1000
const H = 3600

const out = (...notices: unknown[]) => JSON.stringify({ notices })

test('a command\'s JSON becomes notices: levels, one-line text cut to 100, optional detail and until', () => {
  const got = parseNotices(out(
    { id: 'a', level: 'urgent', text: 'x'.repeat(300), detail: 'More\nwords' },
    { id: 'b', level: 'warn', text: 'Soon', until: new Date((NOW + H) * 1000).toISOString() },
    { id: 'c', level: 'info', text: 'FYI' },
  ), NOW)
  expect(got.map(n => n.id)).toEqual(['a', 'b', 'c'])
  expect(got[0]?.text.length).toBe(100)
  expect(got[0]?.detail).toBe('More words')
  expect(got[1]?.until).toBe(NOW + H)
})

test('bad output is no notices: junk, wrong shape, missing id or text, unknown level, expired, duplicate ids', () => {
  expect(parseNotices('oops', NOW)).toEqual([])
  expect(parseNotices('', NOW)).toEqual([])
  expect(parseNotices('{"notices":"x"}', NOW)).toEqual([])
  expect(parseNotices('[]', NOW)).toEqual([])
  const got = parseNotices(out(
    { level: 'warn', text: 'no id' }, { id: 'x', level: 'warn' }, { id: 'y', level: 'loud', text: 'level' },
    { id: 'old', level: 'warn', text: 'gone', until: new Date((NOW - 1) * 1000).toISOString() },
    { id: 'd', level: 'warn', text: 'first' }, { id: 'd', level: 'urgent', text: 'second' }, 7, null,
  ), NOW)
  expect(got.map(n => n.text)).toEqual(['first'])
  expect(parseNotices(out(...Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, level: 'warn', text: 't' }))), NOW)).toHaveLength(20)
})

test('escapes and control characters never reach the terminal', () => {
  const [n] = parseNotices(out({ id: `i${ESC}[2J`, level: 'warn', text: `${ESC}[31mred${ESC}[0m\u0007 and ${ESC}]8;;https://x.test\u0007link‮`,
    detail: `a\u0000b${ESC}[H` }), NOW)
  expect(n?.text).toBe('red and link')
  expect(n?.id).toBe('i')
  expect(n?.detail).toBe('a b')
  expect(`${n?.id}${n?.text}${n?.detail}`).not.toMatch(/[\u0000-\u001f\u007f-\u009f‮]/)
})

test('a notice is gone once its until passes', () => {
  const list = parseNotices(out({ id: 'a', level: 'warn', text: 't', until: new Date((NOW + 60) * 1000).toISOString() }), NOW)
  expect(inForce(list, NOW)).toHaveLength(1)
  expect(inForce(list, NOW + 61)).toHaveLength(0)
})

test('cadence: a warn toast once, again after the repeat hours; an urgent one at most every 2 h; info never', () => {
  const list = parseNotices(out({ id: 'w', level: 'warn', text: 'w' }, { id: 'u', level: 'urgent', text: 'u' }, { id: 'i', level: 'info', text: 'i' }), NOW)
  const at = NOW * 1000
  expect(toastsDue(list, {}, at, 6).map(n => n.id)).toEqual(['w', 'u'])
  const seen = { w: at, u: at }
  expect(toastsDue(list, seen, at + 1.9 * H * 1000, 6)).toEqual([])
  expect(toastsDue(list, seen, at + 2.1 * H * 1000, 6).map(n => n.id)).toEqual(['u'])
  expect(toastsDue(list, seen, at + 6.1 * H * 1000, 6).map(n => n.id)).toEqual(['w', 'u'])
  // A shorter repeat setting still governs an urgent one.
  expect(toastsDue(list, seen, at + 1.1 * H * 1000, 1).map(n => n.id)).toEqual(['w', 'u'])
  expect(toastText(list[1]!)).toBe('⚠ u')
  expect(toastText(list[0]!)).toBe('w')
})

test('the marker counts warn and urgent notices only, red for urgent and amber for warn', () => {
  const list = parseNotices(out({ id: 'w', level: 'warn', text: 'w' }, { id: 'i', level: 'info', text: 'i' }), NOW)
  expect(noticeSegment(list)).toMatchObject({ tone: 'warn', forms: ['⚠ 1 · /g-line notices', '⚠ 1 notices', '⚠ 1'], keep: 2, priority: 60 })
  expect(noticeSegment(parseNotices(out({ id: 'i', level: 'info', text: 'i' }), NOW))).toBeUndefined()
  const both = parseNotices(out({ id: 'w', level: 'warn', text: 'w' }, { id: 'u', level: 'urgent', text: 'u' }), NOW)
  expect(noticeSegment(both)).toMatchObject({ tone: 'bad', forms: ['⚠ 2 · /g-line notices', '⚠ 2 notices', '⚠ 2'] })
  expect(noticeRows(both).map(r => r.level)).toEqual(['urgent', 'warn'])
})

const WIDTHS = [36, 44, 56, 72, 90, 120, 160, 220]
const calm: Payload = {
  model: { display_name: 'Opus 5.5' }, effort: { level: 'xhigh' },
  context_window: { used_percentage: 17, context_window_size: 1_000_000, total_input_tokens: 170_000 },
  rate_limits: {
    five_hour: { used_percentage: 3, resets_at: NOW + 8 * H + 45 * 60 },
    seven_day: { used_percentage: 30, resets_at: NOW + 2 * 24 * H + 9 * H },
  },
  prompt_cache: { warm: true, caching_observed: true, ttl: '1h', expires_at: NOW + 59 * 60 + 20, recache_tokens_if_cold: 191_000 },
}

test('at every width the marker stays whole beside the figures the person needs', () => {
  const marker = noticeSegment(parseNotices(out({ id: 'u', level: 'urgent', text: 'u' }, { id: 'w', level: 'warn', text: 'w' }), NOW))!
  const extras = [marker, { key: 'agents', priority: 68, forms: ['agents 4 (2 Explore)', 'agents 4', 'ag 4'] },
    { key: 'others', priority: 30, forms: ['3 others'] }, accountSegment('me@example.com')!]
  for (const columns of WIDTHS) {
    const d = deck(calm, { now: NOW, utcOffsetMinutes: 660, zone: 'UTC+11' },
      { now: tailRoom(columns, '(shift+tab to cycle)'), next: nextRoom(columns), rows: nextRows(columns) }, extras)
    const rows = [d.next, ...d.more].map(joined)
    const all = [joined(d.now), ...rows].join(' · ')
    expect(`${columns}: ${all}`).toContain('⚠ 2')
    if (columns >= 160) expect(all).toContain('⚠ 2 · /g-line notices')
    for (const figure of ['Opus', 'cache', 'me@example.com', '5h 3%', 'wk 30%', '8h 45m', '2d 9h']) expect(`${columns}: ${all}`).toContain(figure)
    expect(rows.length).toBeLessThanOrEqual(nextRows(columns))
    for (const row of rows) expect(width(row)).toBeLessThanOrEqual(nextRoom(columns) ?? 0)
  }
})

test('config: notices_command is a list of words; interval and repeat have defaults and bounds; /g-line notices parses', () => {
  expect(DEFAULTS.noticesIntervalMinutes).toBe(5)
  expect(DEFAULTS.noticesRepeatHours).toBe(6)
  expect(merge(DEFAULTS, {}).noticesCommand).toBeUndefined()
  const c = merge(DEFAULTS, { notices_command: ['my-alerts-tool', '--json'], notices_interval_minutes: 10, notices_repeat_hours: 12 })
  expect(c.noticesCommand).toEqual(['my-alerts-tool', '--json'])
  expect(c.noticesIntervalMinutes).toBe(10)
  expect(c.noticesRepeatHours).toBe(12)
  expect(merge(DEFAULTS, { notices_command: 'my-alerts-tool', notices_interval_minutes: 0 }).noticesCommand).toBeUndefined()
  expect(merge(DEFAULTS, { notices_interval_minutes: 0 }).noticesIntervalMinutes).toBe(5)
  expect(parseCommand('notices')).toEqual({ kind: 'notices' })
})

test('a long account label never pushes the timings and clock times off line 2 for the marker', () => {
  const marker = noticeSegment(parseNotices(out({ id: 'u', level: 'urgent', text: 'u' }, { id: 'w', level: 'warn', text: 'w' }), NOW))!
  for (const columns of [36, 40, 50]) {
    const d = deck(calm, { now: NOW, utcOffsetMinutes: 660, zone: 'UTC+11' },
      { now: tailRoom(columns, '(shift+tab to cycle)'), next: nextRoom(columns), rows: nextRows(columns) }, [marker, accountSegment('a-long-account-label-24c')!])
    const all = [joined(d.now), ...[d.next, ...d.more].map(joined)].join(' · ')
    // At 36 columns the clock times don't fit even without the marker; the timings must.
    for (const figure of columns === 36 ? [/resets (in )?8h 45m/, /resets (in )?2d 9h/, /⚠ 2/] : [/\(21:45/, /\(Fri 22:00/, /resets (in )?8h 45m/, /resets (in )?2d 9h/, /⚠ 2/])
      expect(`${columns}: ${all}`).toMatch(figure)
  }
})

test('one toast per run: the most severe, and how many more', () => {
  const list = parseNotices(out({ id: 'w', level: 'warn', text: 'warned' }, { id: 'u', level: 'urgent', text: 'urgent one' }, { id: 'w2', level: 'warn', text: 'x' }), NOW)
  expect(toastFor(list)).toBe('⚠ urgent one +2 more · /g-line notices')
  expect(toastFor([list[0]!])).toBe('warned')
  expect(toastFor([])).toBeUndefined()
})

test('failures are named, and a failed run keeps the last good list for two intervals', () => {
  expect(runFailure({ exitCode: 0 })).toBeUndefined()
  expect(runFailure({ exitCode: 3 })).toBe('exit code 3')
  expect(runFailure({ exitCode: 127 })).toBe('not found')
  expect(runFailure(new Error('spawn x ENOENT'))).toBe('not found')
  expect(runFailure(new Error('Timed out after 5000ms'))).toBe('timed out')
  expect(readNotices('oops', NOW).failure).toBe('not JSON')
  expect(readNotices('{"notices":[]}', NOW)).toEqual({ notices: [] })
  expect(keepsLast(1000, 1000 + 9 * 60_000, 5)).toBe(true)
  expect(keepsLast(1000, 1000 + 11 * 60_000, 5)).toBe(false)
  expect(keepsLast(0, 5, 5)).toBe(false)
})

test('until: a finite number is Unix seconds; an unusable until drops the notice', () => {
  const got = parseNotices(out(
    { id: 'n', level: 'warn', text: 'num', until: NOW + H },
    { id: 'past', level: 'warn', text: 'past', until: NOW - 5 },
    { id: 'bad', level: 'warn', text: 'bad', until: 'next tuesday-ish' },
    { id: 'nan', level: 'warn', text: 'nan', until: {} },
    { id: 'none', level: 'warn', text: 'none' },
  ), NOW)
  expect(got.map(n => n.id)).toEqual(['n', 'none'])
  expect(got[0]?.until).toBe(NOW + H)
})

test('invisible format characters are removed: tags, soft hyphen, Arabic letter mark, Mongolian vowel separator', () => {
  const [n] = parseNotices(out({ id: 'i', level: 'warn', text: `a\u{E0001}b\u00adc\u061cd\u180ee\u200bf` }), NOW)
  expect(n?.text).toBe('abcdef')
  expect(clean(`x\u{E0041}y\u00adz`, 20)).toBe('xyz')
})
