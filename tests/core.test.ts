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
