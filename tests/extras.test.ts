import { expect, test } from 'claude-code/testing'

import {
  EMPTY_TOTALS, adaptiveParts, agentsSegment, cacheHit, cardLines, coach, compactionText, contextView, costRatio, dayOf,
  forecast, forecastSegment, ledger, loopWarning, receiptFields, receiptParts, receiptText, spark, spinnerParts,
  staleKeys, target, todaySegment, turnLength, turnLineWidth, unusedServers,
} from '../hooks/extras'
import type { ReceiptField } from '../hooks/extras'
import { inline, joined, modesWidth } from '../hooks/inline'
import type { AgentRow, Receipt } from '../types'

const NOW = 1_760_000_000
const RECEIPT: Receipt = { cost: 0.384, cacheHit: 94.6, context: 6200, tools: 7, agents: 2, output: 1200,
  endAt: NOW * 1000, durationMs: 64_000, background: false }

const fields = (spec: string) => receiptFields(spec) as ReceiptField[]
const texts = (r: Receipt) => adaptiveParts(r).map(p => p.text)

test('a fixed receipt reads like the line it rides on, and drops its last parts to fit', async () => {
  expect(receiptText(RECEIPT, fields('short'))).toBe(' · API $0.38 · cache read 94% · 7 tools')
  expect(receiptText(RECEIPT, fields('full'))).toBe(' · API $0.38 · cache read 94% · +6k context · 7 tools · 2 agents · 1k out')
  expect(receiptText(RECEIPT, fields('cost,tools'))).toBe(' · API $0.38 · 7 tools')
  expect(receiptText(RECEIPT, fields('short'), 30)).toBe(' · API $0.38 · cache read 94%')
  expect(receiptText(RECEIPT, fields('short'), 5)).toBe('')
  expect(receiptFields('off')).toEqual([])
  expect(receiptFields('nonsense')).toBe('adaptive')
  expect(receiptFields(undefined)).toBe('adaptive')
  // Zero and unknown figures are left out, never shown as 0.
  expect(receiptParts({ ...RECEIPT, cost: 0, cacheHit: undefined, tools: 1 }, fields('short')).map(p => p.text)).toEqual(['1 tool'])
  expect(receiptParts({ ...RECEIPT, context: -40_000 }, ['context']).map(p => p.text)).toEqual(['−40k context'])
  // 99.9% never rounds up to a perfect 100%.
  expect(receiptParts({ ...RECEIPT, cacheHit: 99.9 }, ['cache']).map(p => p.text)).toEqual(['cache read 99%'])
  expect(cacheHit({ input_tokens: 4, cache_read_input_tokens: 940, cache_creation_input_tokens: 56 })).toBe(94)
  expect(cacheHit({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBeUndefined()
})

test('the adaptive receipt stays quiet on an ordinary turn and leads with what was unusual', async () => {
  const quiet: Receipt = { ...RECEIPT, window: 200_000, warmBefore: true, cacheWrite: 6000 }
  expect(texts(quiet)).toEqual(['API $0.38', 'cache read 94%'])
  // A big context jump leads, loud, then the cost.
  const jump = { ...quiet, context: 84_000, cacheWrite: 84_000, cost: 1.42 }
  expect(adaptiveParts(jump)).toEqual([{ tone: 'accent', text: '+84k context' }, { text: 'API $1.42' }])
  // Under 8k (or 2% of a big window) is no jump.
  expect(texts({ ...quiet, context: 7999 })).toEqual(['API $0.38', 'cache read 94%'])
  expect(texts({ ...quiet, context: 15_000, window: 1_000_000 })).toEqual(['API $0.38', 'cache read 94%'])
  expect(texts({ ...quiet, context: 25_000, window: 1_000_000 })[0]).toBe('+25k context')
  // A large cache write the context's growth doesn't explain; never on the session's first write.
  expect(adaptiveParts({ ...quiet, cacheWrite: 84_000, context: 2000 })[0]).toEqual({ tone: 'warn', text: 'cache write 84k' })
  expect(texts({ ...quiet, cacheWrite: 84_000, context: 2000, warmBefore: false })).toEqual(['API $0.38', 'cache read 94%'])
  // Failures come first; one tool is named, mixed ones are counted.
  expect(adaptiveParts({ ...quiet, failures: 3, failedTool: 'Bash' })[0]).toEqual({ tone: 'bad', text: '3 failed Bash calls' })
  expect(texts({ ...quiet, failures: 2 })[0]).toBe('2 failed calls')
  expect(texts({ ...quiet, failures: 1, failedTool: 'Bash' })).toEqual(['API $0.38', 'cache read 94%'])
  expect(texts({ ...quiet, compacted: { before: 182_000, after: 31_000 }, context: -151_000 })[0]).toBe('compacted 182k → 31k')
  // A cold cache, rebuilt by the turn's first request, is said as such.
  expect(adaptiveParts({ ...quiet, cold: true, cacheWrite: 84_000, context: 3000, cacheHit: 12 })[0]).toEqual({ tone: 'warn', text: 'cache cold · rebuilt 84k' })
  // Background work makes the session's growth not the turn's own: no dollars then.
  expect(texts({ ...jump, overlap: true })).toEqual(['+84k context'])
  expect(texts({ ...quiet, overlap: true })).toEqual(['cache read 94%'])
  // A cost several times the recent median says so, after the cost.
  expect(adaptiveParts({ ...quiet, cost: 1.42, ratio: 4.1 })).toEqual([{ text: 'API $1.42' }, { tone: 'accent', text: '4x recent' }])
  expect(texts({ ...jump, ratio: 4.1 })).toEqual(['+84k context', 'API $1.42', '4x recent'])
  // Narrow rows drop the supporting facts first and keep the lead.
  expect(receiptText(jump, 'adaptive', 17)).toBe(' · +84k context')
})

test('a cost is an outlier only against enough attributable history, by ratio and by dollars', async () => {
  const history = [0.3, 0.2, 0.4, 0.3, 0.35]
  expect(costRatio(1.2, false, history)).toBe(4)
  expect(costRatio(1.2, false, history.slice(0, 4))).toBeUndefined()
  expect(costRatio(1.2, true, history)).toBeUndefined()
  expect(costRatio(0.6, false, history)).toBeUndefined()
  // Cheap turns can be many times cheaper turns without being worth a word.
  expect(costRatio(0.12, false, [0.02, 0.03, 0.02, 0.03, 0.02])).toBeUndefined()
})

test('the spinner says the burn so far, and names the tool and file once calls keep failing', async () => {
  expect(spinnerParts({ tools: 3, agents: 0, contextGrowth: 4100 }, 74)).toEqual(['3 tools', '+4.1k ctx', '5h 74%'])
  expect(spinnerParts({ tools: 5, agents: 1, failures: 3, failedTool: 'Edit', failedTarget: 'core.ts' })).toEqual(['⚠ 3× Edit failures on core.ts', '5 tools', '1 agent'])
  expect(spinnerParts({ tools: 5, agents: 0, failures: 3, failedTool: null })).toEqual(['⚠ 3 failed calls', '5 tools'])
  expect(spinnerParts({ tools: 0, agents: 0, failures: 1, failedTool: 'Edit', contextGrowth: 400 })).toEqual([])
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
  expect(forecastSegment({ turns: 1, percent: 98, threshold: 967_000 })?.forms[0]).toBe('compacts soon')
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
  expect(loopWarning('Edit', 'core.ts', 3)).toBe('⚠ 3× Edit failures in a row on core.ts. Worth a look before it burns more of your limit.')
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
    'g-line · session card',
    'Opus 5.5 · 1h 12m · 23 turns',
    '87 tool calls · 4 agents · 2 failed calls',
    'cache read 94% · 1 compaction · 1 cold-cache rebuild',
    '$3.21 at API prices · peak context 61% · 5h window 72%',
    'today: $41.00 over 6 sessions on this machine',
  ])
})

test('mod-only segments stand where a custom layout names them, and the footer keeps its gap', async () => {
  const p = { model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: 78 } }
  const extras = { compact: forecastSegment({ turns: 3, percent: 80, threshold: 1 }), agents: undefined }
  expect(joined(inline(p, { now: NOW, segments: 'model,context,compact,agents' }, undefined, undefined, extras)))
    .toBe('Opus 5.5 · ctx 78% · compacts in ~3 turns')
  expect(joined(inline(p, { now: NOW }, undefined, undefined, extras))).toBe('Opus 5.5 · ctx 78%')
  expect(joined(inline(p, { now: NOW }, undefined, undefined, {}, [todaySegment({ day: 'x', cost: 45, turns: 1, tools: 0, sessions: 1, colds: 0, agents: 0 }, 50)!])))
    .toBe('Opus 5.5 · ctx 78% · today $45.00 of $50.00')
  expect(modesWidth([])).toBe(0)
  expect(modesWidth(['agents 2 running', 'compacts in ~3 turns'])).toBe('agents 2 running & compacts in ~3 turns'.length + 4)
})
