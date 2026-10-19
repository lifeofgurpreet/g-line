import { expect, test } from 'claude-code/testing'

import { cells, clean, countOf, muted, pageOf, parseFeed, pulseRow, tickerText } from '../hooks/pulse'

const ESC = String.fromCharCode(27)
const AT = Date.parse('2026-10-14T12:00:00Z')

test('the feed\'s optional text, likes and author are read and cleaned; a 0.5 feed still parses', () => {
  const long = 'word '.repeat(200)
  const feed = parseFeed(JSON.stringify({ schema: 1, items: [
    { title: 'Short', url: 'https://x.com/a/status/1', source: '𝕏 @a', text: `${ESC}[31mRed${ESC}[0m and ${long}`, likes: 12.7, author_name: `A${ESC}[1m` },
    { title: 'Same', url: 'https://x.com/b/status/2', source: '𝕏 @b', text: 'Same', likes: -3 },
    { title: 'Plain', url: 'https://example.com', source: 'Anthropic' },
    { title: 'HN', url: 'https://krea.ai', source: 'Hacker News', points: 254, discussion: 'https://news.ycombinator.com/item?id=1' },
    { title: 'Wire', url: 'https://reuters.com/a', source: 'Reuters', via: 'Techmeme', discussion: 'javascript:alert(1)' },
    { title: 'Post', url: 'https://x.com/c/status/3', source: '𝕏 @c', story: `Story ${ESC}[2Jhere` },
  ] }), 0)
  const [a, b, c, hn, wire, post] = feed?.items ?? []
  expect(hn?.points).toBe(254)
  expect(hn?.discussion).toBe('https://news.ycombinator.com/item?id=1')
  expect(wire?.via).toBe('Techmeme')
  expect(wire?.discussion).toBeUndefined()
  expect(post?.story).toBe('Story here')
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

test('the reader pages around the picked item, and counts read at a glance', () => {
  expect(pageOf(3, 0)).toEqual([0, 3])
  expect(pageOf(20, 0)).toEqual([0, 5])
  expect(pageOf(20, 10)).toEqual([8, 13])
  expect(pageOf(20, 19)).toEqual([15, 20])
  expect([countOf(999), countOf(4200), countOf(4000), countOf(12_345), countOf(2_500_000)]).toEqual(['999', '4.2k', '4k', '12k', '2.5M'])
})

test('emoji and wide characters count two columns, so a headline never wraps its row', () => {
  expect(cells('🚀 ok')).toBe(5)
  expect(cells('日本')).toBe(4)
  expect(cells('e\u0301')).toBe(1)
  // A variation selector is dropped: the symbol keeps its one-column text form.
  expect(clean('❤\ufe0f x', 10)).toBe('❤ x')
  const cut = clean('🚀🚀🚀🚀🚀🚀', 7)
  expect(cut).toBe('🚀🚀🚀…')
  expect(cells(cut)).toBeLessThanOrEqual(7)
  const item = { title: '🚀 DeepSeek-V4.1-Flash-1017 is here! Stronger benchmark performance across the board', url: 'https://x.com/d/status/1', source: '𝕏 @deepseek_ai', at: '2026-10-13T12:00:00Z' }
  for (const room of [60, 80, 96]) {
    const row = pulseRow(item, room, AT)
    expect(row).toBeDefined()
    expect(cells(`${row?.lead ? `${row.lead}: ` : ''}${row?.title}${row?.tail}`)).toBeLessThanOrEqual(room)
  }
})

test('a mute matches within the source, any case; the spinner holds one headline when paused', () => {
  const x = { title: 'Post', url: 'https://x.com/a/status/1', source: '𝕏 @claudeai' }
  const hn = { title: 'Story', url: 'https://example.com/b', source: 'Hacker News' }
  expect(muted(x, ['𝕏'])).toBe(true)
  expect(muted(x, ['@ClaudeAI'])).toBe(true)
  expect(muted(hn, ['𝕏', 'news.yc'])).toBe(false)
  expect(muted(hn, [])).toBe(false)
  const feed = { fetchedAt: 0, items: [hn, { ...hn, title: 'Second' }] }
  expect(tickerText(feed, 15_000 + 8_000, 80)).toMatch(/^Second/)
  expect(tickerText(feed, 15_000 + 8_000, 80, undefined, 5)).toMatch(/^Story/)
  expect(tickerText(feed, 15_000 + 400_000, 80, undefined, 0)).toMatch(/^Story/)
})
