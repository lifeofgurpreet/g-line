import { expect, test } from 'claude-code/testing'

import { alerts, duration, modelName, pace, plain, render, toastMs, tokens, utcLabel, zoneOffset } from '../hooks/core'
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

test('what warns keeps its words longest as the line narrows, and the cache countdown always shows', async () => {
  const now = 1_760_000_000
  const p: Payload = {
    model: { display_name: 'Opus 5.5' }, effort: { level: 'high' },
    context_window: { used_percentage: 13, context_window_size: 1_000_000, total_input_tokens: 130_000 },
    rate_limits: { five_hour: { used_percentage: 2, resets_at: now + 4 * 3600 },
      seven_day: { used_percentage: 79, resets_at: now + 2 * 86400 } },
    prompt_cache: { warm: true, caching_observed: true, ttl: '1h', expires_at: now + 50 * 60 },
  }
  const line = (columns: number) => plain(render(p, { now, columns, utcOffsetMinutes: 0 }))[0]
  expect(line(200)).toMatch(/^Opus 5\.5 \(high effort\) · ctx 13% \(870k left\) · 5h 2% \(resets in 4h\) · week 79% ! full in ~\d+d \d+h \(back \S+ \S+\) · cache warm \(~50m left\)$/)
  // Calm segments go to their short forms first, the effort kept; the warning keeps "full in ~".
  expect(line(60)).toMatch(/^Opus high · ctx 13% · 5h 2% · wk 79% ! full in ~/)
  // Then calm segments go, the model name first, before the warning loses its projection.
  expect(line(44)).toMatch(/^ctx 13% · 5h 2% · wk 79% ! full in ~/)
  expect(line(30)).toMatch(/^wk 79% ! full in ~/)
  expect(plain(render(p, { now, preset: 'full', utcOffsetMinutes: 0 }))[0]).toMatch(/cache warm \(~50m left\)/)
  const soon = { ...p, prompt_cache: { ...p.prompt_cache, expires_at: now + 4 * 60 } }
  expect(plain(render(soon, { now, utcOffsetMinutes: 0 }))[0]).toMatch(/cache warm \(~4m left\)/)
})

test('0.9.1: a zone\'s offset at an instant, and its label', () => {
  const at = Date.parse('2026-10-23T03:00:00Z')
  expect(zoneOffset('Pacific/Guadalcanal', at)).toBe(660)
  expect(zoneOffset('Asia/Kuala_Lumpur', at)).toBe(480)
  expect(zoneOffset('Asia/Kathmandu', at)).toBe(345)
  expect(zoneOffset('Asia/Jakarta', at)).toBe(420)
  expect(zoneOffset('Europe/Berlin', at)).toBe(120)
  expect(zoneOffset('Europe/Berlin', Date.parse('2026-12-01T03:00:00Z'))).toBe(60)
  expect(zoneOffset('Mars/Olympus', at)).toBeUndefined()
  expect(zoneOffset(undefined, at)).toBeUndefined()
  expect([utcLabel(660), utcLabel(345), utcLabel(-180), utcLabel(0)]).toEqual(['UTC+11', 'UTC+5:45', 'UTC-3', 'UTC+0'])
})

test('a toast stays about as long as it takes to read: three seconds at least, never past nine or what was asked', () => {
  expect(toastMs('◆ opened github.com in your browser')).toBe(3750)
  expect(toastMs('ok', 15_000)).toBe(3000)
  expect(toastMs('x'.repeat(400), 15_000)).toBe(9000)
  expect(toastMs('x'.repeat(400), 5000)).toBe(5000)
  // Wide characters count as one character each, not their UTF-16 halves.
  expect(toastMs('𝕏'.repeat(40), 15_000)).toBe(toastMs('x'.repeat(40), 15_000))
})
