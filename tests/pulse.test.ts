import { expect, test } from 'claude-code/testing'

import {
  cells, clean, countOf, itemNow, keptShown, linksDrawn, mergedShown, muted, opensHere, pageOf, parseFeed, pickNext, pulseRow,
  tickerText, withShow,
} from '../hooks/pulse'
import type { Shown } from '../hooks/pulse'

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

test('a mute matches within the source, any case', () => {
  const x = { title: 'Post', url: 'https://x.com/a/status/1', source: '𝕏 @claudeai' }
  const hn = { title: 'Story', url: 'https://example.com/b', source: 'Hacker News' }
  expect(muted(x, ['𝕏'])).toBe(true)
  expect(muted(x, ['@ClaudeAI'])).toBe(true)
  expect(muted(hn, ['𝕏', 'news.yc'])).toBe(false)
  expect(muted(hn, [])).toBe(false)
  expect(tickerText(hn, 15_000 + 8_000, 80)).toBe('Story (Hacker News)')
})

const MIN = 60_000
const items = ['a', 'b', 'c'].map(name => ({ title: name, url: `https://example.com/${name}`, source: 's' }))
const url = (name: string) => `https://example.com/${name}`

test('the cycle: new headlines first in the feed\'s order, never the same one twice in a row', () => {
  expect(pickNext(items, {}, null, 0)?.title).toBe('a')
  let shown = withShow({}, url('a'), 0)
  expect(pickNext(items, shown, url('a'), 8000)?.title).toBe('b')
  shown = withShow(shown, url('b'), 8000)
  expect(pickNext(items, shown, url('b'), 16_000)?.title).toBe('c')
  shown = withShow(shown, url('c'), 16_000)
  // Every headline shown and resting: hold still on the one showing.
  expect(pickNext(items, shown, url('c'), 24_000)).toBeUndefined()
  expect(itemNow(items, shown, url('c'), 24_000)?.title).toBe('c')
  // A new headline from a refreshed feed goes first.
  const refreshed = [{ title: 'd', url: url('d'), source: 's' }, ...items]
  expect(pickNext(refreshed, shown, url('c'), 30_000)?.title).toBe('d')
  // A refresh never puts the headline showing now on again: with one item left, it holds.
  expect(pickNext([items[2]!], {}, url('c'), 0)).toBeUndefined()
})

test('the cycle: a shown headline rests 30 minutes, longest-rested first, and shows at most 3 times a day', () => {
  let shown: Shown = {}
  for (const [i, name] of ['a', 'b', 'c'].entries()) shown = withShow(shown, url(name), i * 8000)
  expect(pickNext(items, shown, url('c'), 29 * MIN)).toBeUndefined()
  expect(pickNext(items, shown, url('c'), 31 * MIN)?.title).toBe('a')
  shown = withShow(withShow(shown, url('a'), 31 * MIN), url('a'), 62 * MIN)
  expect(shown[url('a')]?.n).toBe(3)
  // `a` has had its three shows; `b` rested longest.
  expect(pickNext(items, shown, url('c'), 200 * MIN)?.title).toBe('b')
  // Counts older than a day are forgotten; malformed ones dropped.
  const kept = keptShown({ [url('a')]: { n: 3, at: 0 }, [url('b')]: { n: 1, at: 20 * 3_600_000 }, bad: { n: 'x' } }, 25 * 3_600_000)
  expect(Object.keys(kept)).toEqual([url('b')])
  // Two sessions' counts merge to the larger count and the later time.
  expect(mergedShown({ [url('a')]: { n: 1, at: 5 } }, { [url('a')]: { n: 2, at: 3 } })[url('a')]).toEqual({ n: 2, at: 5 })
})

test('links follow Claude Code\'s own rule: herdr and SSH draw none unless FORCE_HYPERLINK says so', () => {
  expect(linksDrawn({ TERM_PROGRAM: 'ghostty' })).toBe(true)
  expect(linksDrawn({ TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5.0' })).toBe(true)
  expect(linksDrawn({ TERM_PROGRAM: 'kitty' })).toBe(true)
  expect(linksDrawn({ TERM: 'xterm-kitty' })).toBe(true)
  expect(linksDrawn({ TERM_PROGRAM: 'WezTerm', TERM_PROGRAM_VERSION: '20240203-110809-5046fc22' })).toBe(true)
  expect(linksDrawn({ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.71.0' })).toBe(false)
  expect(linksDrawn({ TERM_PROGRAM: 'vscode', TERM_PROGRAM_VERSION: '1.95.0' })).toBe(true)
  expect(linksDrawn({ WT_SESSION: 'x' })).toBe(true)
  // tmux sets TERM_PROGRAM itself; 3.4 and later pass links on.
  expect(linksDrawn({ TERM_PROGRAM: 'tmux', TERM_PROGRAM_VERSION: '3.4', TMUX: '/tmp/x' })).toBe(true)
  expect(linksDrawn({ TERM_PROGRAM: 'tmux', TERM_PROGRAM_VERSION: '3.3a', TMUX: '/tmp/x' })).toBe(false)
  // herdr, and a session over SSH that carries no TERM_PROGRAM: Claude Code prints addresses, so plain text.
  expect(linksDrawn({ TERM_PROGRAM: 'herdr', TERM: 'xterm-256color' })).toBe(false)
  expect(linksDrawn({ TERM: 'xterm-256color' })).toBe(false)
  expect(linksDrawn({ TERM_PROGRAM: 'herdr', FORCE_HYPERLINK: '1' })).toBe(true)
  expect(linksDrawn({ TERM_PROGRAM: 'ghostty', FORCE_HYPERLINK: '0' })).toBe(false)
  expect(linksDrawn({ VTE_VERSION: '7600' })).toBe(true)
  expect(linksDrawn({ LC_TERMINAL: 'iTerm2' })).toBe(true)
})

test('a browser opens on a Mac or a Linux desktop, never over SSH or on a box with no display', () => {
  expect(opensHere({ os: 'Darwin', ssh: false, display: false })).toBe(true)
  expect(opensHere({ os: 'Darwin', ssh: true, display: false })).toBe(false)
  expect(opensHere({ os: 'Linux', ssh: false, display: false })).toBe(false)
  expect(opensHere({ os: 'Linux', ssh: false, display: true })).toBe(true)
})

test('a gift link with a long token still parses', () => {
  const long = `https://www.example.com/news/articles/2026-10-20/story?accessToken=${'eyJhbGciOiJIUzI1NiJ9'.repeat(20)}`
  expect(long.length).toBeGreaterThan(400)
  expect(parseFeed(JSON.stringify({ schema: 1, items: [{ title: 'Deal', url: long, source: 'Wire' }] }), 0)?.items.length).toBe(1)
})
