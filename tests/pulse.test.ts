import { expect, test } from 'claude-code/testing'

import { countOf, newestFirst, pageOf, parseFeed, pulseRow } from '../hooks/pulse'

const ESC = String.fromCharCode(27)
const AT = Date.parse('2026-10-14T12:00:00Z')

test('the feed\'s optional text, likes and author are read and cleaned; a 0.5 feed still parses', () => {
  const long = 'word '.repeat(200)
  const feed = parseFeed(JSON.stringify({ schema: 1, items: [
    { title: 'Short', url: 'https://x.com/a/status/1', source: '𝕏 @a', text: `${ESC}[31mRed${ESC}[0m and ${long}`, likes: 12.7, author_name: `A${ESC}[1m` },
    { title: 'Same', url: 'https://x.com/b/status/2', source: '𝕏 @b', text: 'Same', likes: -3 },
    { title: 'Plain', url: 'https://example.com', source: 'Anthropic' },
  ] }), 0)
  const [a, b, c] = feed?.items ?? []
  expect(a?.text?.startsWith('Red and word')).toBe(true)
  expect([...(a?.text ?? '')].length).toBeLessThanOrEqual(600)
  expect(a?.likes).toBe(12)
  expect(a?.author).toBe('A')
  // A text the same as the title, and a negative count, are left out.
  expect(b?.text).toBeUndefined()
  expect(b?.likes).toBeUndefined()
  expect(c).toEqual({ title: 'Plain', url: 'https://example.com/', source: 'Anthropic', at: undefined })
  // The reader sees every item, not the 0.5 ticker's eight.
  const many = parseFeed(JSON.stringify({ schema: 1, items: Array.from({ length: 20 }, (_, i) => ({ title: `t${i}`, url: `https://e.com/${i}`, source: 's' })) }), 0)
  expect(many?.items.length).toBe(20)
})

test('Pulse\'s row: who and how long ago, the headline, and the reader\'s name when it fits', () => {
  const item = { title: 'Claude Dashboards are in beta today', url: 'https://x.com/claudeai/status/1', source: '𝕏 @claudeai', at: '2026-10-14T11:00:00Z' }
  expect(pulseRow(item, 120, AT)).toEqual({ lead: '𝕏 @claudeai · 1h', title: 'Claude Dashboards are in beta today', tail: ' · /g-line news' })
  expect(pulseRow(item, 60, AT)).toEqual({ lead: '𝕏 @claudeai · 1h', title: 'Claude Dashboards are in beta today', tail: '' })
  expect(pulseRow(item, 36, AT)).toEqual({ lead: '', title: 'Claude Dashboards are in beta today', tail: '' })
  expect(pulseRow(item, 20, AT)).toBeUndefined()
  expect(pulseRow({ ...item, source: 'Anthropic', at: undefined }, 120, AT)?.lead).toBe('Anthropic')
})

test('the reader pages around the picked item, newest first, and counts read at a glance', () => {
  expect(pageOf(3, 0)).toEqual([0, 3])
  expect(pageOf(20, 0)).toEqual([0, 5])
  expect(pageOf(20, 10)).toEqual([8, 13])
  expect(pageOf(20, 19)).toEqual([15, 20])
  const items = [
    { title: 'old', url: 'u', source: 's', at: '2026-10-12T00:00:00Z' },
    { title: 'undated', url: 'u', source: 's' },
    { title: 'new', url: 'u', source: 's', at: '2026-10-14T00:00:00Z' },
  ]
  expect(newestFirst(items).map(i => i.title)).toEqual(['new', 'old', 'undated'])
  expect([countOf(999), countOf(4200), countOf(4000), countOf(12_345), countOf(2_500_000)]).toEqual(['999', '4.2k', '4k', '12k', '2.5M'])
})
