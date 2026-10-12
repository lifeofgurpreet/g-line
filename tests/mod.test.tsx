import { expect, mock, test } from 'claude-code/testing'

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

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 }

test('the band draws the session and a toast warns before the 5-hour limit', async ($, on) => {
  const clock = mock.clock(on, { now: NOW * 1000 })
  mock.env(on, { HOME: '/home/someone' })
  const toasts: string[] = []
  on('session.usage', () => ({ value: USAGE }) as never)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '## main...origin/main\n M a.ts\n', stderr: '' } }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('env.set', () => ({ value: undefined }))
  on('fs.read', () => ({ deny: 'no such file' }) as never)
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'glanceline', surface, component: 'AbovePrompt', props: BAND as never })
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /context 41%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5h 72%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /main\*/ })).toBeDefined()
    await ui.unmount()
  }

  await clock.advance(15_000)
  expect(toasts.some(text => text.includes('5-hour limit'))).toBe(true)
  const count = toasts.length
  await clock.advance(30_000)
  expect(toasts.length).toBe(count)
})
