import { expect, test } from 'claude-code/testing'

import { alerts, duration, modelName, pace, plain, render, tokens } from '../hooks/core'
import type { Options, Payload } from '../hooks/core'
import { CASES } from './cases'

const revive = (value: unknown): unknown => {
  if (value === 'NaN') return Number.NaN
  if (Array.isArray(value)) return value.map(revive)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]))
  }
  return value
}

test('every golden case renders as recorded (the Python fallback checks the same file)', async () => {
  expect(CASES.length).toBeGreaterThan(100)
  for (const raw of CASES) {
    const c = revive(raw) as { name: string; payload: Payload; options: Options & { columns?: number }; lines?: string[]; alerts?: unknown }
    if (c.alerts) expect(alerts(c.payload, c.options)).toEqual(c.alerts)
    else expect(plain(render(c.payload, c.options))).toEqual(c.lines)
  }
})

test('countdowns floor, token counts round', async () => {
  expect(duration(59)).toBe('<1m')
  expect(duration(3599)).toBe('59m')
  expect(duration(90061, true)).toBe('1d1h')
  expect(tokens(84213)).toBe('84k')
  expect(tokens(1_000_000)).toBe('1M')
})

test('pace waits for a meaningful rate, then projects it', async () => {
  const now = 1_000_000
  expect(pace('five_hour', { used_percentage: 30, resets_at: now + 4.9 * 3600 }, now)).toBeUndefined()
  expect(pace('five_hour', { used_percentage: 50, resets_at: now + 3 * 3600 }, now)).toEqual({ kind: 'hot', eta: now + 2 * 3600 })
  expect(pace('five_hour', { used_percentage: 10, resets_at: now + 3 * 3600 }, now)).toEqual({ kind: 'ok' })
  expect(pace('five_hour', { used_percentage: 100, resets_at: now + 60 }, now)).toEqual({ kind: 'full' })
})

test('model ids read as names', async () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-sonnet-5-20260901')).toBe('Sonnet 5')
  expect(modelName('claude-fable-5-1[1m]')).toBe('Fable 5.1 (1M)')
  expect(modelName('gpt-oss')).toBe('gpt-oss')
})

test('what warns keeps its words longest as the line narrows, and a healthy cache stays off the default line', async () => {
  const now = 1_760_000_000
  const p: Payload = {
    model: { display_name: 'Opus 5.5' }, effort: { level: 'high' },
    context_window: { used_percentage: 13, context_window_size: 1_000_000, total_input_tokens: 130_000 },
    rate_limits: { five_hour: { used_percentage: 2, resets_at: now + 4 * 3600 },
      seven_day: { used_percentage: 79, resets_at: now + 2 * 86400 } },
    prompt_cache: { warm: true, caching_observed: true, ttl: '1h', expires_at: now + 50 * 60 },
  }
  const line = (columns: number) => plain(render(p, { now, columns, utcOffsetMinutes: 0 }))[0]
  expect(line(200)).toMatch(/^Opus 5\.5 \(high effort\) · ctx 13% \(870k left\) · 5h 2% \(resets in 4h\) · week 79% ! out ~\S+ \S+ \(resets \S+ \S+\)$/)
  // Calm segments go to their short forms first; the warning keeps "out ~".
  expect(line(60)).toMatch(/^Opus 5\.5 · ctx 13% · 5h 2% · wk 79% ! out ~/)
  // Then calm segments go, the model name first, before the warning loses its projection.
  expect(line(44)).toMatch(/^ctx 13% · 5h 2% · wk 79% ! out ~/)
  expect(line(30)).toMatch(/^wk 79% ! out ~/)
  // A warm cache with most of its hour left is not news; the full layout still shows it.
  expect(line(200)).not.toMatch(/cache/)
  expect(plain(render(p, { now, preset: 'full', utcOffsetMinutes: 0 }))[0]).toMatch(/cache warm \(50m left\)/)
  const soon = { ...p, prompt_cache: { ...p.prompt_cache, expires_at: now + 4 * 60 } }
  expect(plain(render(soon, { now, utcOffsetMinutes: 0 }))[0]).toMatch(/cache warm \(4m left\)/)
})
