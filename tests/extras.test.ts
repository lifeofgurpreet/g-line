import { expect, test } from 'claude-code/testing'

import {
  EMPTY_TOTALS, agentsSegment, cacheHit, cardLines, coach, compactionText, contextView, dayOf, forecast,
  forecastSegment, ledger, loopWarning, receiptFields, receiptParts, receiptText, spark, staleKeys, target,
  todaySegment, turnLength, turnLineWidth, unusedServers,
} from '../hooks/extras'
import { inline, joined, modesWidth } from '../hooks/inline'
import type { AgentRow, Receipt } from '../types'

const NOW = 1_760_000_000
const RECEIPT: Receipt = { cost: 0.384, cacheHit: 94.6, context: 6200, tools: 7, agents: 2, output: 1200,
  endAt: NOW * 1000, durationMs: 64_000, background: false }

test('a receipt reads like the line it rides on, and drops its last parts to fit', async () => {
  expect(receiptText(RECEIPT, receiptFields('short'))).toBe(' · $0.38 · 94% cached · 7 tools')
  expect(receiptText(RECEIPT, receiptFields('full'))).toBe(' · $0.38 · 94% cached · +6k context · 7 tools · 2 agents · 1k out')
  expect(receiptText(RECEIPT, receiptFields('cost,tools'))).toBe(' · $0.38 · 7 tools')
  expect(receiptText(RECEIPT, receiptFields('short'), 21)).toBe(' · $0.38 · 94% cached')
  expect(receiptText(RECEIPT, receiptFields('short'), 5)).toBe('')
  expect(receiptFields('off')).toEqual([])
  expect(receiptFields('nonsense')).toEqual(['cost', 'cache', 'tools'])
  // Zero and unknown figures are left out, never shown as 0.
  expect(receiptParts({ ...RECEIPT, cost: 0, cacheHit: undefined, tools: 1 }, receiptFields('short'))).toEqual(['1 tool'])
  expect(receiptParts({ ...RECEIPT, context: -40_000 }, ['context'])).toEqual(['−40k context'])
  // 99.9% cached never rounds up to a perfect 100%.
  expect(receiptParts({ ...RECEIPT, cacheHit: 99.9 }, ['cache'])).toEqual(['99% cached'])
  expect(cacheHit({ input_tokens: 4, cache_read_input_tokens: 940, cache_creation_input_tokens: 56 })).toBe(94)
  expect(cacheHit({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBeUndefined()
})

test('turn lengths match the engine, so the receipt starts right after its words', async () => {
  expect(turnLength(11_668)).toBe('11s')
  expect(turnLength(69_400)).toBe('1m 9s')
  expect(turnLength(3_723_000)).toBe('1h 2m 3s')
  expect(turnLineWidth('Baked', 4160, '3:45 PM')).toBe('✻ Baked for 4s · done 3:45 PM'.length)
  expect(turnLineWidth('Baked', 4160)).toBe('✻ Baked for 4s'.length)
})

test('agents show only while some are at work', async () => {
  const row = (status: string): AgentRow => ({ id: status, description: 'd', type: 'Explore', status, background: true,
    teammate: false, startedAt: 0 })
  expect(agentsSegment([row('completed'), row('failed')])).toBeUndefined()
  expect(agentsSegment([row('running'), row('pending')])?.forms[0]).toBe('agents 2 running')
  expect(agentsSegment([row('running'), row('waiting'), row('completed')])?.forms[0]).toBe('agents 2 (1 running, 1 waiting)')
  expect(agentsSegment([row('waiting')])?.forms).toEqual(['agents 1 waiting', 'agents 1', 'ag 1'])
})

test('the compaction forecast waits for 60% and a trend, then counts turns', async () => {
  expect(forecast(500_000, 967_000, [20_000, 20_000])).toBeUndefined()
  expect(forecast(700_000, 967_000, [30_000])).toBeUndefined()
  expect(forecast(700_000, 967_000, [0, 0, 0])).toBeUndefined()
  expect(forecast(700_000, 967_000, [20_000, 40_000, 30_000])?.turns).toBe(9)
  expect(forecast(900_000, 967_000, [100_000, 100_000])?.turns).toBe(1)
  expect(forecast(620_000, 967_000, [1000, 1000])).toBeUndefined()
  expect(forecastSegment({ turns: 3, percent: 78, threshold: 967_000 })?.forms[0]).toBe('compacts in ~3 turns')
  expect(forecastSegment({ turns: 1, percent: 98, threshold: 967_000 })?.forms[0]).toBe('compacts next turn')
  expect(forecastSegment({ turns: 2, percent: 90, threshold: 967_000 })?.tone).toBe('warn')
  expect(compactionText({ trigger: 'auto', before: 182_000, after: 31_000 })).toBe('Context compacted automatically: 182k → 31k tokens.')
  expect(compactionText({ trigger: 'manual' })).toBe('Context compacted by /compact.')
})

test('the context view keeps categories and servers, never file paths', async () => {
  const view = contextView({
    categories: [{ name: 'System tools', tokens: 18_786, kind: 'used' }, { name: 'Free space', tokens: 900_000, kind: 'free' },
      { name: 'Messages', tokens: 40_000, kind: 'used' }, { name: 'MCP tools', tokens: 38_000, kind: 'used' }],
    totalTokens: 96_786, rawMaxTokens: 1_000_000, autoCompactThreshold: 967_000, isAutoCompactEnabled: true,
    mcpTools: [{ serverName: 'linear', tokens: 30_000, isLoaded: true }, { serverName: 'linear', tokens: 8000, isLoaded: true },
      { serverName: 'sentry', tokens: 5000, isLoaded: false }, { serverName: 'github', tokens: 2000, isLoaded: true }],
    memoryFiles: [{ tokens: 3000 }, { tokens: 1118 }],
    skills: { includedSkills: 40, tokens: 9873 },
  }, NOW)
  expect(view.rows.map(r => r.name)).toEqual(['Messages', 'MCP tools', 'System tools'])
  expect(view.mcp).toEqual([{ server: 'linear', tokens: 38_000, tools: 2 }, { server: 'github', tokens: 2000, tools: 1 }])
  expect(view.memoryTokens).toBe(4118)
  expect(JSON.stringify(view)).not.toMatch(/\//)
  expect(unusedServers(view, { mcp__github__search: { calls: 2, failures: 0 } })).toEqual([{ server: 'linear', tokens: 38_000 }])
})

test('repeated failures name the target briefly', async () => {
  expect(target('Edit', { file_path: '/repo/hooks/core.ts' })).toBe('core.ts')
  expect(target('Bash', { command: 'npm run test -- --watch=false' })).toBe('npm run test')
  expect(target('WebFetch', { url: 'https://example.com/x' })).toBe('https://example.com/x')
  expect(target('Mystery', {})).toBe('Mystery')
  expect(loopWarning('Edit', 'core.ts', 3)).toBe('Edit failed 3× in a row on core.ts. Worth a look before it burns more of your limit.')
})

test('the day ledger sums every session per local day and forgets old days', async () => {
  const today = dayOf(Date.parse('2026-10-13T23:30:00Z'), 330)
  expect(today).toBe('2026-10-14')
  const l = ledger([
    { key: 'd:2026-10-14:a', value: { cost: 1.5, turns: 3, tools: 9, colds: 1, agents: 0 } },
    { key: 'd:2026-10-14:b', value: { cost: 2, turns: 1, tools: 0, colds: 0, agents: 2 } },
    { key: 'd:2026-10-10:a', value: { cost: 4, turns: 5 } },
    { key: 'd:2026-09-01:a', value: { cost: 99 } },
    { key: 'other', value: 1 },
    { key: 'd:2026-10-14:c', value: 'garbage' },
  ], '2026-10-14')
  expect(l.today).toEqual({ day: '2026-10-14', cost: 3.5, turns: 4, tools: 9, sessions: 2, colds: 1, agents: 2 })
  expect(l.week.map(d => d.cost)).toEqual([0, 0, 4, 0, 0, 0, 3.5])
  expect(staleKeys(['d:2026-09-01:a', 'd:2026-10-10:a', 'other'], '2026-10-14')).toEqual(['d:2026-09-01:a'])
  expect(spark([0, 1, 4, 2])).toBe(' ▃█▅')
  expect(todaySegment(l.today)?.forms).toEqual(['today $3.50'])
  expect(todaySegment(l.today, 4)?.tone).toBe('warn')
  expect(todaySegment(l.today, 3)?.tone).toBe('bad')
  expect(todaySegment({ ...l.today, cost: 0 })).toBeUndefined()
})

test('the coach only suggests, and says by how much', async () => {
  const hot = { used_percentage: 50, resets_at: NOW + 3 * 3600 }
  const high = coach('five_hour', hot, NOW, 'high')
  expect(high?.suggest).toBe('/effort medium')
  expect(high?.text).toBe('5-hour limit: out at 10:53 at this pace, resets 11:53. To last, use ~33% less per hour: Tab takes /effort medium.')
  expect(high?.text.length).toBeLessThanOrEqual(120)
  expect(coach('five_hour', hot, NOW, 'low')?.suggest).toBe('/model')
  expect(coach('five_hour', { used_percentage: 10, resets_at: NOW + 3 * 3600 }, NOW, 'high')).toBeUndefined()
})

test('the share card leaves out branch, path and account', async () => {
  const lines = cardLines({ model: 'Opus 5.5', elapsedSeconds: 4320, cost: 3.21, cacheHit: 94, fiveHour: 72, agentsNow: 0,
    totals: { ...EMPTY_TOTALS, turns: 23, tools: 87, agents: 4, failures: 2, colds: 1, peakContext: 61,
      compactions: [{ at: 0, trigger: 'auto', before: 1, after: 1 }] },
    today: { day: '2026-10-13', cost: 41, turns: 80, tools: 300, sessions: 6, colds: 2, agents: 9 } })
  expect(lines).toEqual([
    'glanceline · session card',
    'Opus 5.5 · 1h 12m · 23 turns',
    '87 tool calls · 4 agents · 2 failed calls',
    'cache hit 94% · 1 compaction · 1 cold-cache rebuild',
    '$3.21 at API prices · peak context 61% · 5h window 72%',
    'today: $41.00 over 6 sessions on this machine',
  ])
})

test('mod-only segments stand where a custom layout names them, and the footer keeps its gap', async () => {
  const p = { model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: 78 } }
  const extras = { compact: forecastSegment({ turns: 3, percent: 80, threshold: 1 }), agents: undefined }
  expect(joined(inline(p, { now: NOW, segments: 'model,context,compact,agents' }, undefined, undefined, extras)))
    .toBe('Opus 5.5 · context 78% · compacts in ~3 turns')
  expect(joined(inline(p, { now: NOW }, undefined, undefined, extras))).toBe('Opus 5.5 · context 78%')
  expect(joined(inline(p, { now: NOW }, undefined, undefined, {}, [todaySegment({ day: 'x', cost: 45, turns: 1, tools: 0, sessions: 1, colds: 0, agents: 0 }, 50)!])))
    .toBe('Opus 5.5 · context 78% · today $45.00 of $50.00')
  expect(modesWidth([])).toBe(0)
  expect(modesWidth(['agents 2 running', 'compacts in ~3 turns'])).toBe('agents 2 running & compacts in ~3 turns'.length + 4)
})
