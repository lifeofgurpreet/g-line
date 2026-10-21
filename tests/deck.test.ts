import { expect, test } from 'claude-code/testing'

import { joined } from '../hooks/inline'
import { deck, nextRoom } from '../hooks/deck'
import { alerts } from '../hooks/core'
import { STATUS_DESCRIPTION, statusJson } from '../hooks/glance'
import { clean, parseFeed, tickerText, xLead } from '../hooks/pulse'
import type { Payload } from '../hooks/core'

const NOW = 1_760_000_000
const P: Payload = {
  model: { display_name: 'Opus 5.5' }, effort: { level: 'high' },
  context_window: { used_percentage: 4, context_window_size: 1_000_000, total_input_tokens: 42_000 },
  rate_limits: { five_hour: { used_percentage: 1, resets_at: NOW + 3 * 3600 + 48 * 60 },
    seven_day: { used_percentage: 79, resets_at: NOW + 2 * 86400 } },
  prompt_cache: { warm: true, caching_observed: true, ttl: '1h', expires_at: NOW + 59 * 60 + 30, recache_tokens_if_cold: 120_000 },
}
const O = { now: NOW, utcOffsetMinutes: 0 }

test('the deck: gauges on line 1, the model with its effort, the cache and the timing on line 2', async () => {
  const d = deck(P, O, {})
  expect(joined(d.now)).toBe('ctx 4% · 5h 1% · wk 79%!')
  expect(joined(d.next)).toMatch(/^Opus 5\.5 high · cache warm ~59m \(120k\) · 5h resets in 3h 48m · wk out ~\S+ \S+, resets \S+ \S+$/)
  expect(d.next.find(part => part.key === 'cache')?.tone).toBe('ok')
  expect(d.next.find(part => part.key === 'seven_day_next')?.tone).toBe('warn')
})

test('narrow: line 2 keeps the effort and the cache, and the warning keeps its projection', async () => {
  const d = deck(P, O, { now: 30, next: nextRoom(80) }, [{ key: 'today', priority: 50, forms: ['today $4.63'] }])
  expect(joined(d.now)).toBe('ctx 4% · 5h 1% · wk 79%!')
  expect(joined(d.next)).toMatch(/^Opus high · cache ~59m · 5h resets 3h48m · wk out ~\S+ \S+ · today \$4\.63$/)
  const tight = deck(P, O, { next: 42 })
  expect(joined(tight.next)).toMatch(/^Opus high · cache ~59m · wk out ~/)
})

test('the cache goes amber in its last minutes and says what a cold one costs', async () => {
  const soon = deck({ ...P, prompt_cache: { ...P.prompt_cache, expires_at: NOW + 4 * 60 } }, O, {})
  expect(soon.next.find(part => part.key === 'cache')).toEqual({ key: 'cache', text: 'cache warm ~4m (120k)', tone: 'warn' })
  const cold = deck({ ...P, prompt_cache: { ...P.prompt_cache, warm: false, expires_at: NOW - 10 } }, O, {})
  expect(cold.next.find(part => part.key === 'cache')?.text).toBe('cache cold, next turn rebuilds 120k')
})

test('after a compaction the cache says what the next turn writes, not a rebuild of the old conversation', async () => {
  const compacted = { ...P, prompt_cache: { ...P.prompt_cache, warm: false, compacted: true, recache_tokens_if_cold: 31_000 } }
  expect(deck(compacted, O, {}).next.find(part => part.key === 'cache')).toEqual({ key: 'cache', text: 'compacted, next turn caches 31k' })
  expect(alerts(compacted, O).filter(a => a.id.startsWith('cache'))).toEqual([])
  expect(JSON.parse(statusJson({ p: compacted, now: NOW, section: 'cache' })).cache)
    .toEqual(expect.objectContaining({ state: 'compacted', rebuild_tokens_if_cold: 31_000 }))
})

test('the cold-cache heads-up says Claude Code compacts first when idle compaction covers it', async () => {
  const soon = { ...P, prompt_cache: { ...P.prompt_cache, expires_at: NOW + 4 * 60 } }
  expect(alerts(soon, O)[0]?.text).toMatch(/Reply before then to keep it cached; after, the next turn rebuilds it\.$/)
  const idle = { ...soon, prompt_cache: { ...soon.prompt_cache, idle_compacts: true } }
  expect(alerts(idle, O)[0]?.text).toMatch(/Reply before then to keep it cached; if not, Claude Code compacts the conversation to a summary first\.$/)
})

test('the status tool: a JSON snapshot with scope and basis; unknown stays null, never advice', async () => {
  const body = JSON.parse(statusJson({ p: P, now: NOW, observedAt: NOW - 30, compactAt: 967_000, compactOn: true }))
  expect(body.context).toEqual({ scope: 'main_session', used_tokens: 42_000, window_tokens: 1_000_000, used_percent: 4,
    auto_compact: { enabled: true, threshold_tokens: 967_000, headroom_tokens: 925_000, basis: 'engine_local_estimate' } })
  expect(body.limits.scope).toBe('account')
  expect(body.limits.seven_day.used_percent).toBe(79)
  expect(body.limits.seven_day.projected_limit_at).toMatch(/^2025-/)
  expect(body.limits.five_hour.projected_limit_at).toBeNull()
  expect(body.cache.state).toBe('estimated_warm')
  expect(JSON.parse(statusJson({ p: {}, now: NOW })).context.used_tokens).toBeNull()
  expect(JSON.parse(statusJson({ p: P, now: NOW, disabled: true })).state).toBe('disabled')
  expect(STATUS_DESCRIPTION).toMatch(/Do not poll, send keep-alive prompts, reduce requested work/)
})

test('Pulse text is cleaned before it can reach the terminal, and links must be https', async () => {
  expect(clean('hi \u001b[31mred\u001b[0m \u001b]8;;https://evil\u0007x\u001b]8;;\u0007 \u202ebidi', 80)).toBe('hi red x bidi')
  expect(clean('a'.repeat(50), 10)).toBe('aaaaaaaaa…')
  const feed = parseFeed(JSON.stringify({ schema: 1, items: [
    { title: 'Good', url: 'https://example.com/a', source: 'Simon Willison' },
    { title: 'Bad scheme', url: 'http://example.com/b', source: 'x' },
    { title: 'Creds', url: 'https://u:p@example.com/', source: 'x' },
    { title: '', url: 'https://example.com/c', source: 'x' },
  ] }), 0)
  expect(feed?.items.map(item => item.title)).toEqual(['Good'])
  expect(parseFeed('not json', 0)).toBeUndefined()
  expect(parseFeed(JSON.stringify({ schema: 2, items: [] }), 0)).toBeUndefined()
  expect(tickerText(feed?.items[0], 14_000, 80)).toBe('')
  expect(tickerText(feed?.items[0], 16_000, 80)).toBe('Good (Simon Willison)')
  expect(tickerText(feed?.items[0], 16_000, 10)).toBe('')
})

test('An X post leads with its author and its age', async () => {
  const at = Date.parse('2026-10-10T12:00:00Z')
  const feed = parseFeed(JSON.stringify({ schema: 1, items: [
    { title: 'Claude Dashboards are in beta today', url: 'https://x.com/claudeai/status/1', source: '𝕏 @claudeai', published_at: '2026-10-10T12:00:00Z' },
  ] }), 0)
  const post = feed!.items[0]!
  expect(xLead(post, at + 40 * 60_000)).toBe('𝕏 @claudeai · 40m')
  expect(xLead(post, at + 3_600_000)).toBe('𝕏 @claudeai · 1h')
  expect(xLead(post, at + 3 * 86_400_000)).toBe('𝕏 @claudeai · 3d')
  expect(xLead(post)).toBe('𝕏 @claudeai')
  expect(xLead({ title: 'Good', url: 'https://example.com/a', source: 'Simon Willison' }, at)).toBe('')
  expect(tickerText(post, 16_000, 80, at + 3_600_000)).toBe('𝕏 @claudeai · 1h: Claude Dashboards are in beta today')
  expect(tickerText(post, 16_000, 80, at + 3 * 86_400_000)).toBe('𝕏 @claudeai · 3d: Claude Dashboards are in beta today')
  expect(tickerText(post, 16_000, 30, at)).toBe('Claude Dashboards are in beta…')
})
