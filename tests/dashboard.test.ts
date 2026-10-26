import { expect, test } from 'claude-code/testing'

import { dashboardHtml, esc, historyDays } from '../hooks/dashboard'
import type { DashboardSnapshot } from '../hooks/dashboard'

const NOW = Date.parse('2026-10-26T06:00:00Z') / 1000

const NO_GUARD = { rules: [], why: ['No guard rules: write them under "guard" in config.json.'], on: true, simulated: false, errors: [] }

const EMPTY: DashboardSnapshot = {
  nowSeconds: NOW, utcOffsetMinutes: 480, payload: {}, sessions: [], showAccount: false, ledger: [], guard: NO_GUARD,
}

const FULL: DashboardSnapshot = {
  nowSeconds: NOW, utcOffsetMinutes: 480, tz: 'Asia/Kuala_Lumpur', version: '0.18.1',
  payload: {
    model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: 41 },
    rate_limits: {
      five_hour: { used_percentage: 62, resets_at: NOW + 2 * 3600 + 47 * 60 },
      seven_day: { used_percentage: 48, resets_at: NOW + 3 * 86400 },
    },
    prompt_cache: { caching_observed: true, ttl: '1h', warm: true, expires_at: NOW + 42 * 60, recache_tokens_if_cold: 57_000 },
    git: { branch: 'secret-branch' } as never,
  },
  sessions: [
    { entry: { id: 'a', at: NOW * 1000, state: 'working', since: NOW * 1000 - 180_000, ctx: 41, model: 'Opus 5.5', account: 'me@example.com' }, mine: true },
    { entry: { id: 'b', at: NOW * 1000, state: 'waiting', since: NOW * 1000 - 90_000, ctx: 70, model: 'Sonnet 5.5' }, mine: false },
  ],
  showAccount: false,
  ledger: [
    { key: 'd:2026-10-26:a', value: { cost: 3.5, turns: 20, tools: 80, colds: 2, agents: 4, warms: 3, warmCost: 0.4 } },
    { key: 'd:2026-10-26:b', value: { cost: 1.5, turns: 10, tools: 20, colds: 1, agents: 0 } },
    { key: 'd:2026-10-25:a', value: { cost: 2, turns: 8, tools: 30, colds: 0, agents: 1 } },
    { key: 'd:2026-09-01:a', value: { cost: 99, turns: 99 } },
  ],
  guard: {
    rules: [{ text: 'at 10% of 5h left, lower effort', inForce: true }, { text: 'at 5% of week left, stop', inForce: false }],
    why: ['In force: lower effort.'], on: true, simulated: false, keepWarm: 'keep-warm: after 50m idle', errors: [],
  },
}

test('an empty store renders and says what is missing', () => {
  const html = dashboardHtml(EMPTY)
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toContain('No usage readings yet')
  expect(html).toContain('No sessions reported')
  expect(html).toContain('No history yet')
  expect(html).toContain('No prompt cache observed')
  expect(html).toContain('No guard rules.')
  expect(html).toContain('A snapshot: run /g-line dashboard again to refresh.')
  expect(html).toContain('version unknown')
})

test('a populated snapshot renders every section', () => {
  const html = dashboardHtml(FULL)
  expect(html).toContain('5-hour 62% used, resets 08:47 (in 2h 47m)'.replace('08:47', '16:47'))
  expect(html).toContain('weekly 48% used')
  expect(html).toContain('Times are in Asia/Kuala_Lumpur (UTC+8)')
  expect(html).toContain('working 3m (this one)')
  expect(html).toContain('waiting on you 1m')
  expect(html).toContain('ctx 70%')
  expect(html).toContain('2026-10-26')
  expect(html).toContain('$5.00')
  expect(html).toContain('<svg')
  expect(html).toContain('This week (last 7 days): 38 turns')
  expect(html).toContain('cache warm ~42m')
  expect(html).toContain('An estimate')
  expect(html).toContain('In force: at 10% of 5h left, lower effort')
  expect(html).toContain('Not in force: at 5% of week left, stop')
  expect(html).toContain('In force: lower effort.')
  expect(html).toContain('keep-warm: after 50m idle')
  expect(html).toContain('Generated 2026-10-26 14:00 (UTC+8) by g-line 0.18.1.')
  // The 14-day table leaves out a day older than the window.
  expect(html).not.toContain('2026-09-01')
})

test('the pace projection reads as line 2 states it', () => {
  const resets = NOW + 4 * 3600
  const hot = dashboardHtml({ ...EMPTY, payload: { rate_limits: { five_hour: { used_percentage: 80, resets_at: resets } } } })
  expect(hot).toContain('On pace to run out: 5h out ~')
  const full = dashboardHtml({ ...EMPTY, payload: { rate_limits: { five_hour: { used_percentage: 100, resets_at: resets } } } })
  expect(full).toContain('The window is full.')
})

test('history sums sessions per day and keeps 14 days', () => {
  const days = historyDays(FULL.ledger, '2026-10-26', 14)
  expect(days).toHaveLength(14)
  expect(days[13]).toMatchObject({ day: '2026-10-26', cost: 5, turns: 30, colds: 3, tools: 100, agents: 4, warms: 3, warmCost: 0.4, sessions: 2 })
  expect(days[0]?.day).toBe('2026-10-13')
})

test('every string is escaped', () => {
  expect(esc('<script>alert("x")</script> & \'y\'')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;')
  const evil = '<script>alert(1)</script>"&'
  const html = dashboardHtml({
    ...FULL, version: evil, tz: evil, showAccount: true,
    sessions: [{ entry: { id: 'a', at: NOW * 1000, state: 'idle', since: NOW * 1000, model: evil, account: evil }, mine: true }],
    guard: { rules: [{ text: evil, inForce: true }], why: [evil], on: true, simulated: true, keepWarm: evil, errors: [evil] },
  })
  expect(html).not.toContain('<script')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;')
})

test('nothing is loaded from anywhere', () => {
  for (const html of [dashboardHtml(EMPTY), dashboardHtml(FULL)]) {
    expect(/https?:\/\//i.test(html)).toBe(false)
    expect(/\b(src|href)\s*=/i.test(html)).toBe(false)
    expect(/url\(/i.test(html)).toBe(false)
    expect(/@import/i.test(html)).toBe(false)
    expect(/<(script|link|img|iframe|object|embed|form)\b/i.test(html)).toBe(false)
    expect(/<meta[^>]+http-equiv/i.test(html)).toBe(false)
  }
})

test('light and dark, system fonts, phone width', () => {
  const html = dashboardHtml(EMPTY)
  expect(html).toContain('prefers-color-scheme: dark')
  expect(html).toContain('name="viewport"')
  expect(html).toContain('system-ui')
  expect(html).not.toContain('—')
})

test('private by default: no path, branch or email without account_command', () => {
  const html = dashboardHtml({
    ...FULL,
    payload: { ...FULL.payload, git: { branch: 'secret-branch', repo: 'secret-repo' } as never },
    ledger: [...FULL.ledger, { key: 'd:2026-10-26:/Users/me/secret-repo', value: { path: '/Users/me/secret-repo', cost: 1 } }],
  })
  for (const secret of ['secret-branch', 'secret-repo', 'me@example.com', '/Users/me', 'example.com']) expect(html).not.toContain(secret)
  // With account_command set, the account shows for the session that has one.
  expect(dashboardHtml({ ...FULL, showAccount: true })).toContain('me@example.com')
})

test('guard: none says so; rules are written out, and simulated readings are marked', () => {
  expect(dashboardHtml(EMPTY)).toContain('No guard rules.')
  expect(dashboardHtml(EMPTY)).not.toContain('What is in force now')
  const html = dashboardHtml({ ...FULL, guard: { ...FULL.guard, simulated: true, on: false } })
  expect(html).toContain('Simulated readings')
  expect(html).toContain('The guard is off.')
  expect(html).toContain('What is in force now')
})
