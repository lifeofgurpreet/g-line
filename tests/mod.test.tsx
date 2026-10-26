import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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

function world(on: On, config?: unknown) {
  const clock = mock.clock(on, { now: NOW * 1000 })
  mock.env(on, { HOME: '/home/someone' })
  const toasts: string[] = []
  const writes: string[] = []
  const tails: (string | undefined)[] = []
  const hints: string[] = []
  on('session.usage', () => ({ value: USAGE }) as never)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '## main...origin/main\n M a.ts\n', stderr: '' } }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('fs.read', ($, e) => (config !== undefined && /\/(g-line|glanceline)\/config\.json$/.test(e.path)
    ? { value: JSON.stringify(config) } : { deny: 'no such file' }) as never)
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
    hints.push(e.props.hint)
    tails.push(e.props.tail)
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}{e.props.tail ? ` · ${e.props.tail}` : ''}</Text>
  })

  return { clock, toasts, writes, tails, hints }
}

test('two lines: the gauges ride the hint line, the model, cache and timing go on a coloured line under it', { timeoutMs: 30_000 }, async ($, on) => {
  const { clock, toasts, writes, tails } = world(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  expect(writes).toContain('/home/someone/.cache/glanceline/live/session-1')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'g-line', surface, component: 'PromptHint', props: HINT,
      viewport: { columns: 160, rows: 40 } })
    const line = tails[tails.length - 1] ?? ''
    expect(line).toBe('ctx 41% · 5h 72%! · wk 20%')
    // The engine's hint is kept whole in this layout, and the tail rides after it.
    expect(await ui.find({ type: 'Text', text: /\? for shortcuts · ctx 41%/ })).toBeDefined()
    // Line 2, the mod's own row: the model with its effort, then what happens next.
    expect(await ui.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^5h out ~\d\d:\d\d, resets \d\d:\d\d$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^wk resets in 5d/ })).toBeDefined()
    // The branch is opt-in (`git: true`), so neither line names the repository.
    expect(await ui.find({ type: 'Text', text: /main/ })).toBeUndefined()
    await ui.unmount()
  }

  // Narrow: each line narrows on its own; the warning keeps its projection.
  const narrow = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { ...HINT, hint: '(shift+tab to cycle)' }, viewport: { columns: 80, rows: 40 } })
  const short = tails[tails.length - 1] ?? ''
  expect(short.length).toBeLessThanOrEqual(80 - 5 - 26 - 20 - 3)
  expect(short).toMatch(/5h 72%!/)
  expect(await narrow.find({ type: 'Text', text: /^5h out ~/ })).toBeDefined()
  await narrow.unmount()

  await clock.advance(15_000)
  expect(toasts.some(text => text.includes('5-hour limit'))).toBe(true)
  const count = toasts.length
  await clock.advance(30_000)
  expect(toasts.length).toBe(count)
})

test('one line, when asked: everything on the hint line, the standing hint shortened to make room', { timeoutMs: 30_000 }, async ($, on) => {
  const { tails, hints } = world(on, { lines: 1 })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { ...HINT, hint: '(shift+tab to cycle)' }, viewport: { columns: 140, rows: 40 } })
  // A rewritten hint carries the text itself; the tail stays empty.
  expect(hints[hints.length - 1]).toMatch(/^⇧⇥ · Opus 5\.5 · ctx 41% \(118k left\) · 5h 72% ! out ~/)
  expect(tails[tails.length - 1]).toBeUndefined()
  await ui.unmount()
  // A hint that isn't a standing one (a key to press, a pill) is never shortened.
  const busy = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { ...HINT, hint: 'esc to interrupt', isWorking: true }, viewport: { columns: 140, rows: 40 } })
  expect(hints[hints.length - 1]).toBe('esc to interrupt')
  expect(tails[tails.length - 1]).toMatch(/^Opus 5\.5 · ctx 41%/)
  await busy.unmount()
})

test('the account folds in last, as just the address, and drops before the limits', { timeoutMs: 30_000 }, async () => {
  expect(accountSegment('account space@example.com (via my-accounts)')?.forms).toEqual(['space@example.com'])
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
  const wide = joined(inline(p, o, 'account space@example.com (via my-accounts)', tailRoom(150, '(shift+tab to cycle)')))
  expect(wide).toBe('Opus 5.5 high · ctx 5% · 5h 1% (4h52m) · wk 40% (3d13h) · cache ~59m · space@example.com')
  const tight = joined(inline(p, o, 'account space@example.com (via my-accounts)', 50))
  expect(tight.length).toBeLessThanOrEqual(50)
  expect(tight).not.toMatch(/space@/)
  expect(tight).toMatch(/5h 1%/)
  expect(inline(p, o, undefined, 3)).toEqual([])
  expect(joined(inline(p, o))).not.toMatch(/@/)
})
