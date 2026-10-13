import { expect, mock, test } from 'claude-code/testing'

import { accountSegment, inline, joined, tailRoom } from '../hooks/inline'

const NOW = 1_760_000_000
const ISO = (seconds: number) => new Date(seconds * 1000).toISOString()

const USAGE = {
  startedAt: (NOW - 3600) * 1000,
  context: { tokens: 82_000, window: 200_000, percent: 41 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 72, resetsAt: ISO(NOW + 2 * 3600) },
    { kind: 'seven_day', percentUsed: 20, resetsAt: ISO(NOW + 5 * 86400) },
  ],
  cost: { usd: 3.21 },
}

const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

test('one line rides the hint under the prompt, and a toast warns before the 5-hour limit', async ($, on) => {
  const clock = mock.clock(on, { now: NOW * 1000 })
  mock.env(on, { HOME: '/home/someone' })
  const toasts: string[] = []
  const writes: string[] = []
  const tails: (string | undefined)[] = []
  on('session.usage', () => ({ value: USAGE }) as never)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '## main...origin/main\n M a.ts\n', stderr: '' } }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('fs.read', () => ({ deny: 'no such file' }) as never)
  on('fs.write', ($, e) => {
    writes.push(e.path)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  // Beneath the mod stands the engine's hint line: it draws the hint, then the tail.
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    tails.push(e.props.tail)
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}{e.props.tail ? ` · ${e.props.tail}` : ''}</Text>
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(writes).toContain('/home/someone/.cache/glanceline/live/session-1')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'glanceline', surface, component: 'PromptHint', props: HINT,
      viewport: { columns: 160, rows: 40 } })
    const line = tails[tails.length - 1] ?? ''
    expect(line).toMatch(/^Opus 5\.5 · context 41% \(118k left\) · 5h 72%/)
    expect(line).toMatch(/main\*$/)
    expect(line.includes('\n')).toBe(false)
    expect(await ui.find({ type: 'Text', text: /\? for shortcuts · Opus 5\.5/ })).toBeDefined()
    await ui.unmount()
  }

  // Narrow: the least important segments drop and the line still fits.
  const narrow = await $.ui.mount({ plugin: 'glanceline', surface: 'terminal', component: 'PromptHint',
    props: { ...HINT, hint: '(shift+tab to cycle)' }, viewport: { columns: 90, rows: 40 } })
  const short = tails[tails.length - 1] ?? ''
  expect(short.length).toBeLessThanOrEqual(90 - 5 - 26 - 20 - 3)
  expect(short).toMatch(/^Opus 5\.5/)
  expect(short).toMatch(/5h 72%/)
  await narrow.unmount()

  await clock.advance(15_000)
  expect(toasts.some(text => text.includes('5-hour limit'))).toBe(true)
  const count = toasts.length
  await clock.advance(30_000)
  expect(toasts.length).toBe(count)
})

test('the account folds in last, as just the address, and drops before the limits', async () => {
  expect(accountSegment('account space@example.com (via CAAM)')?.forms).toEqual(['space@example.com'])
  expect(accountSegment('cluster prod-eu')?.forms).toEqual(['cluster prod-eu'])
  expect(accountSegment('  ')).toBeUndefined()
  const p = {
    model: { display_name: 'Opus 5.5' }, effort: { level: 'high' },
    context_window: { used_percentage: 5, context_window_size: 200_000, total_input_tokens: 10_000 },
    rate_limits: { five_hour: { used_percentage: 1, resets_at: NOW + 4 * 3600 + 52 * 60 + 30 },
      seven_day: { used_percentage: 40, resets_at: NOW + 3 * 86400 + 13 * 3600 + 30 } },
    prompt_cache: { caching_observed: true, warm: true, ttl: '1h', expires_at: NOW + 59 * 60 + 30 },
  }
  const o = { now: NOW }
  const wide = joined(inline(p, o, 'account space@example.com (via CAAM)', tailRoom(150, '(shift+tab to cycle)')))
  expect(wide).toBe('Opus 5.5 high · context 5% · 5h 1% (4h52m) · wk 40% (3d13h) · cache 59m · space@example.com')
  const tight = joined(inline(p, o, 'account space@example.com (via CAAM)', 50))
  expect(tight.length).toBeLessThanOrEqual(50)
  expect(tight).not.toMatch(/space@/)
  expect(tight).toMatch(/5h 1%/)
  expect(inline(p, o, undefined, 3)).toEqual([])
  expect(joined(inline(p, o))).not.toMatch(/@/)
})
