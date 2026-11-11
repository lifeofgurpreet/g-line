import { expect, test } from 'claude-code/testing'

import { accountSegment, joined, tailRoom } from '../hooks/inline'
import { deck, nextRoom, nextRows } from '../hooks/deck'
import { width } from '../hooks/core'
import type { Payload, Segment } from '../hooks/core'

// Every width a person reads g-line at: a phone held upright through mosh (36, 44),
// a herdr pane or a zoomed-in terminal (56 to 90), a desktop terminal (120 to 220).
const WIDTHS = [36, 44, 56, 72, 90, 120, 160, 220]

// Wed 11 Nov 2026 02:00 UTC: 13:00 for a person at UTC+11 reading a box in Europe.
const NOW = Date.UTC(2026, 10, 11, 2, 0) / 1000
const H = 3600
const MINE = { now: NOW, utcOffsetMinutes: 660, zone: 'UTC+11' }

const calm: Payload = {
  model: { display_name: 'Opus 5.5' }, effort: { level: 'xhigh' },
  context_window: { used_percentage: 17, context_window_size: 1_000_000, total_input_tokens: 170_000 },
  rate_limits: {
    // A reset 8h 45m away: the figure once read as "45 minutes".
    five_hour: { used_percentage: 3, resets_at: NOW + 8 * H + 45 * 60 },
    seven_day: { used_percentage: 30, resets_at: NOW + 2 * 24 * H + 9 * H },
  },
  prompt_cache: { warm: true, caching_observed: true, ttl: '1h', expires_at: NOW + 59 * 60 + 20, recache_tokens_if_cold: 191_000 },
}
const hotWeek: Payload = {
  ...calm,
  rate_limits: { five_hour: { used_percentage: 0, resets_at: NOW + 3 * H + 56 * 60 }, seven_day: { used_percentage: 88, resets_at: NOW + 32 * H } },
}
const extras = (): Segment[] => [
  { key: 'agents', priority: 68, forms: ['agents 4 (2 Explore)', 'agents 4', 'ag 4'] },
  { key: 'others', priority: 30, forms: ['3 others'] },
  { key: 'git', priority: 60, forms: ['main*'] },
  accountSegment('me@example.com')!,
]
const HINT = '(shift+tab to cycle)'

function lines(p: Payload, columns: number, o: typeof MINE | { now: number; utcOffsetMinutes: number } = MINE) {
  const d = deck(p, o, { now: tailRoom(columns, HINT), next: nextRoom(columns), rows: nextRows(columns) }, extras())
  return { now: joined(d.now), rows: [d.next, ...d.more].map(joined), d }
}

test('at every width, every row fits, and line 2 takes no more rows than the width allows', async () => {
  for (const p of [calm, hotWeek]) {
    for (const columns of WIDTHS) {
      const { now, rows } = lines(p, columns)
      expect(width(now)).toBeLessThanOrEqual(Math.max(0, tailRoom(columns, HINT) ?? 0))
      expect(rows.length).toBeLessThanOrEqual(nextRows(columns))
      for (const row of rows) expect(width(row)).toBeLessThanOrEqual(nextRoom(columns) ?? 0)
    }
  }
})

test('at every width the figures the person needs stay: model, cache, account, context, 5h and week with how long and when', async () => {
  for (const columns of WIDTHS) {
    const { now, rows } = lines(calm, columns)
    const all = [now, ...rows].join(' · ')
    for (const figure of ['Opus', 'xhigh', 'cache', '~59m', 'me@example.com', 'ctx 17%', '5h 3%', 'wk 30%', '8h 45m', '2d 9h']) {
      expect(`${columns}: ${all}`).toContain(figure)
    }
    // On his clock: the 5-hour window at 21:45, the week on Friday at 22:00.
    expect(`${columns}: ${all}`).toMatch(/\(21:45( UTC\+11)?\)/)
    expect(`${columns}: ${all}`).toMatch(/\(Fri 22:00( UTC\+11)?\)/)
  }
})

test('an hours part is never dropped: "8h 45m" never reads as "45m", at any width', async () => {
  for (const p of [calm, hotWeek]) {
    for (const columns of WIDTHS) {
      const all = [lines(p, columns).now, ...lines(p, columns).rows].join(' · ')
      // One spelling: no span run together (`8h45m`), and nothing cut short with `…`.
      expect(`${columns}: ${all}`).not.toMatch(/\d+h\d+m|\d+d\d+h|…/)
      // The minutes of a span over an hour always follow its hours.
      expect(`${columns}: ${all}`).not.toMatch(/(?<!8h )\b45m\b/)
    }
  }
})

test('a week on pace to run out says when it fills and, from 40 columns, when it is back', async () => {
  for (const columns of WIDTHS) {
    const all = [lines(hotWeek, columns).now, ...lines(hotWeek, columns).rows].join(' · ')
    expect(`${columns}: ${all}`).toMatch(/wk 88%!/)
    expect(`${columns}: ${all}`).toMatch(/full (in )?~\d+h/)
    if (columns >= 40) expect(`${columns}: ${all}`).toMatch(/back Thu 21:00/)
    expect(`${columns}: ${all}`).toMatch(/3h 56m \(16:56( UTC\+11)?\)/)
  }
})

test('whose clock: said once, where there is room, when the person\'s zone isn\'t the machine\'s; never where it is', async () => {
  for (const columns of WIDTHS) {
    const all = [lines(calm, columns).now, ...lines(calm, columns).rows].join(' · ')
    expect((all.match(/UTC\+11/g) ?? []).length).toBeLessThanOrEqual(1)
    // It never costs a row: it shows where the rows the figures need have room for it.
    if ([44, 56, 90, 160, 220].includes(columns)) expect(`${columns}: ${all}`).toContain('(21:45 UTC+11)')
    const local = [lines(calm, columns, { now: NOW, utcOffsetMinutes: 660 }).now, ...lines(calm, columns, { now: NOW, utcOffsetMinutes: 660 }).rows].join(' · ')
    expect(local).not.toContain('UTC')
  }
})

test('what isn\'t needed goes first: the branch, the others and the agents before a figure loses a part', async () => {
  for (const columns of WIDTHS) {
    const { d } = lines(calm, columns)
    const keys = [d.next, ...d.more].flat().map(part => part.key)
    const shown = [d.next, ...d.more].flat()
    // A low-value segment shows only where every needed figure kept its clock.
    if (keys.some(key => ['agents', 'others', 'git'].includes(key))) {
      expect(shown.filter(part => /^(5h|wk)/.test(part.text)).every(part => /\((Fri )?\d\d:\d\d( UTC\+11)?\)/.test(part.text))).toBe(true)
    }
  }
  // The widest screen shows everything.
  expect(lines(calm, 220).rows).toEqual([
    'Opus 5.5 xhigh · cache warm ~59m (191k) · 5h resets in 8h 45m (21:45 UTC+11) · wk resets in 2d 9h (Fri 22:00) · me@example.com · agents 4 (2 Explore) · 3 others · main*',
  ])
})

test('the matrix, as the person sees it on a phone, a herdr pane and a desktop', async () => {
  expect(lines(calm, 44)).toEqual(expect.objectContaining({ now: '', rows: [
    'Opus 5.5 xhigh · ctx 17% · ag 4 · main*',
    'cache warm ~59m (191k) · me@example.com',
    '5h 3% resets in 8h 45m (21:45 UTC+11)',
    'wk 30% resets in 2d 9h (Fri 22:00)',
  ] }))
  expect(lines(calm, 90)).toEqual(expect.objectContaining({ now: 'ctx 17% · 5h 3% · wk 30%', rows: [
    'Opus 5.5 xhigh · cache warm ~59m (191k) · 5h resets in 8h 45m (21:45 UTC+11) · main*',
    'wk resets in 2d 9h (Fri 22:00) · me@example.com · agents 4 · 3 others',
  ] }))
  expect(lines(calm, 120)).toEqual(expect.objectContaining({ now: 'ctx 17% · 5h 3% · wk 30%', rows: [
    'Opus 5.5 xhigh · cache ~59m (191k) · 5h resets in 8h 45m (21:45) · wk resets in 2d 9h (Fri 22:00) · me@example.com',
  ] }))
})
