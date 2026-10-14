// The mod-only features end to end, through the engine's own dispatch: the
// hooks beneath stand for Claude Code and answer what it would.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const NOW = 1_760_000_000
const ISO = (seconds: number) => new Date(seconds * 1000).toISOString()
const SUMMARY = [{ role: 'user', text: 'Summary of the conversation so far.', toolUses: [] }]
const USAGE_ARGS = { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 9400, cache_creation_input_tokens: 596 }

type World = {
  clock: ReturnType<typeof mock.clock>
  toasts: string[]
  notes: { text: string; title?: string }[]
  suggested: string[]
  copied: string[]
  usage: { cost: number; tokens: number; percent: number; limits: { kind: string; percentUsed: number; resetsAt?: string }[] }
  agents: { id: string; description: string; type: string; status: string }[]
  notifySent: boolean
  toolError: boolean
  writes: { path: string; text: string }[]
  config?: unknown
}

/** Claude Code beneath the mod, with what each test needs to steer it. */
function world(on: On, stored: Record<string, unknown> = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: NOW * 1000 }), toasts: [], notes: [], suggested: [], copied: [],
    usage: { cost: 1, tokens: 600_000, percent: 60, limits: [] }, agents: [], notifySent: true, toolError: false, writes: [],
  }
  mock.env(on, { HOME: '/home/someone' })
  mock.store(on, stored)
  on('tool.call', () => (w.toolError
    ? { isError: true, result: 'old_string not found', text: 'old_string not found' }
    : { result: 'ok', text: 'ok' }) as never)
  on('session.usage', ($, e) => ({
    value: {
      startedAt: (NOW - 3600) * 1000,
      context: {
        tokens: w.usage.tokens, window: 1_000_000, percent: w.usage.percent,
        breakdown: e.breakdown ? {
          categories: [{ name: 'Messages', tokens: w.usage.tokens - 40_000, kind: 'used', color: 'x', isDeferred: false },
            { name: 'MCP tools', tokens: 40_000, kind: 'used', color: 'x', isDeferred: false }],
          totalTokens: w.usage.tokens, maxTokens: 1_000_000, rawMaxTokens: 1_000_000, autocompactSource: 'auto',
          percentage: w.usage.percent, gridRows: [], model: 'claude-opus-5-5',
          memoryFiles: [{ path: '/home/someone/CLAUDE.md', type: 'User', tokens: 900 }],
          mcpTools: [{ name: 'mcp__linear__create', serverName: 'linear', tokens: 40_000, isLoaded: true }],
          agents: [], autoCompactThreshold: 967_000, isAutoCompactEnabled: true, apiUsage: null,
        } : undefined,
      },
      rateLimits: w.usage.limits,
      cost: { usd: w.usage.cost },
    },
  }) as never)
  on('session.id', () => ({ value: 'session-1' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '## feat/secret-branch\n', stderr: '' } }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('fs.read', ($, e) => (w.config !== undefined && /\/(g-line|glanceline)\/config\.json$/.test(e.path)
    ? { value: JSON.stringify(w.config) } : { deny: 'no such file' }) as never)
  on('fs.write', ($, e) => {
    w.writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.notify', ($, e) => {
    w.notes.push({ text: e.text, title: e.title })
    return { value: w.notifySent ? { isSent: true, channel: 'iterm2' } : { isSent: false, reason: 'no-channel' } } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.copy', ($, e) => {
    w.copied.push(e.text)
    return { value: { isCopied: true } } as never
  })
  on('prompt.suggest', ($, e) => {
    w.suggested.push(e.text)
    return { isShown: true }
  })
  on('agent.list', () => ({ value: w.agents.map(a => ({ ...a })) }) as never)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  return w
}

async function start($: Engine) {
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
}

/** One main-loop turn: its start, `tools` tool calls, its end and its closing line. */
async function turn($: Engine, w: World, n: number, opts: { tools?: number; durationMs?: number; grow?: number; cost?: number } = {}) {
  await $.turn.start({ text: 'go', turnId: `t${n}` })
  for (let i = 0; i < (opts.tools ?? 0); i++) await $.tool.call({ tool: 'Read', file_path: `/work/f${i}.ts` } as never)
  w.usage.cost += opts.cost ?? 0.38
  w.usage.tokens += opts.grow ?? 6000
  await $.turn.complete({ answer: 'done', durationMs: opts.durationMs ?? 64_000, isAborted: false, turnId: `t${n}`,
    reason: 'answer', usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await $.session.append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice',
    origin: { kind: 'engine' }, uuid: `line-${n}` } as never)
  await w.clock.advance(5)
}

test('each turn closes with its receipt, right after Claude Code\'s own words', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`✻ ${e.props.word} for 1m 4s · done 3:45 PM`}</Text>
  })
  await start($)
  await turn($, w, 1, { tools: 7 })
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-1',
    props: { word: 'Baked', durationMs: 64_000 }, viewport: { columns: 120, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: 'API $0.38' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'cache read 94%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Baked for 1m 4s/ })).toBeDefined()
  await ui.unmount()
  // A line the mod has no receipt for is Claude Code's alone.
  const other = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'old',
    props: { word: 'Baked', durationMs: 1000 }, viewport: { columns: 120, rows: 40 } })
  expect(await other.find({ type: 'Text', text: /cache read/ })).toBeUndefined()
  await other.unmount()
  // Narrow: the receipt drops its last parts and never wraps the row.
  const narrow = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-1',
    props: { word: 'Baked', durationMs: 64_000 }, viewport: { columns: 50, rows: 40 } })
  expect(await narrow.find({ type: 'Text', text: 'API $0.38' })).toBeDefined()
  expect(await narrow.find({ type: 'Text', text: 'cache read 94%' })).toBeUndefined()
  await narrow.unmount()
})

test('the receipt can be switched off from /config', { timeoutMs: 30_000, options: { receipt: 'off' } }, async ($, on) => {
  const w = world(on)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`✻ ${e.props.word}`}</Text>
  })
  await start($)
  await turn($, w, 1)
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-1',
    props: { word: 'Baked', durationMs: 64_000 }, viewport: { columns: 120, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: /cache read/ })).toBeUndefined()
})

test('the spinner says what the running turn has done so far', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  const suffixes: string[] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    suffixes.push(e.props.suffix)
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.word}{e.props.suffix}</Text>
  })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/work/b.ts' } as never)
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Spinner',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' }, viewport: { columns: 120, rows: 40 } })
  expect(suffixes[suffixes.length - 1]).toBe('… · 2 tools')
  await ui.unmount()
  void w
})

test('a heads-up reaches you outside the terminal, or as a toast when it cannot', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.usage.limits = [{ kind: 'five_hour', percentUsed: 92, resetsAt: ISO(NOW + 60) }]
  await start($)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 },
    rateLimits: w.usage.limits, cost: { usd: 1 }, changed: ['rateLimits'] })
  await w.clock.advance(75_000)
  expect(w.notes.map(n => n.text)).toContain("Your 5-hour usage window has reset. You'd reached 92% of it.")
  const count = w.notes.length
  await w.clock.advance(60_000)
  expect(w.notes.length).toBe(count)
})

test('with no notification channel the reset falls back to a toast; below the threshold it stays quiet', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.notifySent = false
  await start($)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: ISO(NOW + 30) }, { kind: 'seven_day', percentUsed: 20, resetsAt: ISO(NOW + 30) }],
    cost: { usd: 1 }, changed: ['rateLimits'] })
  await w.clock.advance(60_000)
  expect(w.toasts.filter(t => t.includes('has reset'))).toEqual(["Your 5-hour usage window has reset. You'd reached 85% of it."])
})

test('long turns notify only when asked to, from config.json', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { notify: { long_turn: true }, long_turn_seconds: 30 }
  await start($)
  await turn($, w, 1, { durationMs: 45_000 })
  await turn($, w, 2, { durationMs: 10_000 })
  expect(w.notes.map(n => n.text)).toEqual(['Turn finished after 45s · $0.38.'])
})

test('long turns stay quiet by default', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  await turn($, w, 1, { durationMs: 600_000 })
  expect(w.notes).toEqual([])
})

test('agents at work show in the footer labels (one-line layout), and a failed one raises a heads-up', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { lines: 1 }
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  const modes: string[][] = []
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    modes.push([...e.props.modes])
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.modes.join(' & ')}</Text>
  })
  const tails: (string | undefined)[] = []
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    tails.push(e.props.tail)
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
  await start($)
  await $.agent.spawn({ tool_use_id: 'tu1', prompt: 'p', description: 'Audit the README', subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  w.agents = [{ id: 'a1', description: 'Audit the README', type: 'Explore', status: 'running' }]
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'g-line', surface, component: 'SessionMode', props: { modes: ['focus'] } })
    expect(modes[modes.length - 1]).toEqual(['focus', 'agents 1 running'])
    await ui.unmount()
  }
  const hint = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 140, rows: 40 } })
  expect(tails[tails.length - 1]).not.toMatch(/agents/)
  await hint.unmount()
  w.agents = [{ id: 'a1', description: 'Audit the README', type: 'Explore', status: 'failed' }]
  await w.clock.advance(15_000)
  expect(w.toasts).toContain('Background agent "Audit the README" failed.')
  const after = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(modes[modes.length - 1]).toEqual([])
  await after.unmount()
})

test('the compaction forecast counts down in the footer (one-line layout) and suggests /compact; a compaction is logged', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { coach: true, lines: 1 }
  on('session.compact', () => ({ messages: SUMMARY, tokensBefore: 912_000, tokensAfter: 31_000 }) as never)
  const modes: string[][] = []
  on('ui.render', { component: 'SessionMode' }, ($, e) => {
    modes.push([...e.props.modes])
    const { Text } = $.ui.resolve(e)
    return <Text>x</Text>
  })
  await start($)
  w.usage.tokens = 700_000
  await turn($, w, 1, { grow: 40_000 })
  await turn($, w, 2, { grow: 40_000 })
  await turn($, w, 3, { grow: 40_000 })
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(modes[modes.length - 1]).toEqual(['compacts in ~4 turns'])
  await ui.unmount()
  await turn($, w, 4, { grow: 70_000 })
  await turn($, w, 5, { grow: 70_000 })
  expect(w.toasts.some(t => t.startsWith('Context compacts in ~'))).toBe(true)
  expect(w.suggested).toContain('/compact keep ')
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  expect(w.toasts).toContain('Context compacted automatically: 912k → 31k tokens.')
  const later = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'SessionMode', props: { modes: [] } })
  expect(modes[modes.length - 1]).toEqual([])
  await later.unmount()
})

test('the same call failing three times in a row raises one toast; the calls themselves pass untouched', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.toolError = true
  await start($)
  const results = []
  for (let i = 0; i < 4; i++) results.push(await $.tool.call({ tool: 'Edit', file_path: '/work/hooks/core.ts', old_string: 'a', new_string: 'b' } as never))
  expect(results.every(r => r.isError === true && r.text === 'old_string not found')).toBe(true)
  expect(w.toasts.filter(t => t.includes('3× Edit failures in a row on core.ts'))).toHaveLength(1)
})

test('the coach suggests a lower effort and never switches it', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { coach: true }
  let switched = false
  on('config.set', () => {
    switched = true
    return { value: undefined } as never
  })
  await start($)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: ISO(NOW + 3 * 3600) }], cost: { usd: 1 }, changed: ['rateLimits'] })
  await w.clock.settle()
  expect(w.toasts.some(t => /^5-hour limit: out at .* less per hour: Tab takes \/model\.$/.test(t))).toBe(true)
  expect(w.suggested).toEqual(['/model'])
  expect(switched).toBe(false)
})

test('the coach has spoken for this window in another session: only the plain heads-up', { timeoutMs: 30_000 }, async ($, on) => {
  const resets = NOW + 3 * 3600
  const w = world(on, { [`coach:five_hour:${resets}`]: NOW - 600 })
  await start($)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: ISO(resets) }], cost: { usd: 1 }, changed: ['rateLimits'] })
  await w.clock.settle()
  expect(w.toasts.some(t => t.startsWith("At this pace you'll hit your 5-hour limit"))).toBe(true)
  expect(w.suggested).toEqual([])
})

test('a weekly window on pace to run out gets the plain heads-up, no coaching', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 98, resetsAt: ISO(NOW + 86400) }], cost: { usd: 1 }, changed: ['rateLimits'] })
  await w.clock.settle()
  expect(w.toasts.some(t => t.startsWith("At this pace you'll hit your weekly limit"))).toBe(true)
  expect(w.suggested).toEqual([])
})

test('today and this week add up across sessions in the store, and the pane says so', { timeoutMs: 30_000 }, async ($, on) => {
  const day = new Date(NOW * 1000 - new Date(NOW * 1000).getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
  const w = world(on, { [`d:${day}:other-session`]: { cost: 10, turns: 4, tools: 12, colds: 0, agents: 1 }, 'd:2020-01-01:gone': { cost: 1 } })
  await start($)
  await turn($, w, 1, { tools: 2 })
  await $.command.run({ command: 'g-line', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
    props: { bodyColumns: 90 } as never, viewport: { columns: 160, rows: 50 } })
  expect(await pane.find({ type: 'Text', text: /today \$10\.38 at API prices · 5 turns · 2 sessions/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /MCP linear: 40k of tool definitions, none called/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /CLAUDE\.md|\/home\// })).toBeUndefined()
})

test('/g-line card is a share card with no branch, path or account, copied as text', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { account_command: ['echo', 'someone@example.com'] }
  await start($)
  await turn($, w, 1, { tools: 3 })
  const answer = await $.command.run({ command: 'g-line', args: 'card' } as never)
  // Nothing goes back into the conversation: Claude reads a command's text.
  expect(answer).toEqual({})
  const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
    props: { bodyColumns: 90 } as never, viewport: { columns: 160, rows: 50 } })
  expect(await pane.find({ type: 'Text', text: 'g-line · session card' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /secret-branch|someone@|\/work/ })).toBeUndefined()
  await pane.press({ key: 'copy' })
  expect(w.copied[0]).toMatch(/^g-line · session card\n/)
  expect(w.copied[0]).toMatch(/lifeofgurpreet\/g-line/)
  expect(w.copied[0]).not.toMatch(/secret-branch|someone@/)
})

test('nothing is added above the prompt and no status row is pinned', { timeoutMs: 30_000 }, async ($, on) => {
  world(on)
  let statuses = 0
  on('ui.status', () => {
    statuses += 1
    return { value: undefined } as never
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine band</Text>
  })
  await start($)
  const band = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'AbovePrompt',
    props: { bodyColumns: 100 } as never, viewport: { columns: 100, rows: 40 } })
  expect(await band.find({ type: 'Text', text: 'engine band' })).toBeDefined()
  expect(statuses).toBe(0)
})

test('with notifications off in /config, heads-ups stay in the terminal', { timeoutMs: 30_000, options: { notifications: false } }, async ($, on) => {
  const w = world(on)
  await start($)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: ISO(NOW + 30) }], cost: { usd: 1 }, changed: ['rateLimits'] })
  await w.clock.advance(60_000)
  expect(w.notes).toEqual([])
  expect(w.toasts).toContain("Your 5-hour usage window has reset. You'd reached 97% of it.")
})

test('export_state writes the figures as JSON for other bars, and only when asked', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { export_state: true }
  await start($)
  await w.clock.advance(15_000)
  const state = w.writes.filter(one => one.path === '/home/someone/.cache/g-line/state/session-1.json')
  expect(state.length).toBeGreaterThan(0)
  const body = JSON.parse(state[state.length - 1]?.text ?? '{}')
  expect(body.model).toBe('Opus 5.5')
  expect(body.line).toMatch(/^Opus 5\.5 · ctx 60%/)
})

test('the coach is off by default: a hot window gets the plain heads-up and nothing in the prompt box', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: ISO(NOW + 3 * 3600) }], cost: { usd: 1 }, changed: ['rateLimits'] })
  await w.clock.settle()
  expect(w.toasts.some(t => t.startsWith("At this pace you'll hit your 5-hour limit"))).toBe(true)
  expect(w.suggested).toEqual([])
})

test('/g-line off is silent: no toasts, notifications or suggestions while hidden', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { coach: true }
  await start($)
  await $.command.run({ command: 'g-line', args: 'off' } as never)
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 50, resetsAt: ISO(NOW + 3 * 3600) }], cost: { usd: 1 }, changed: ['rateLimits'] })
  w.toolError = true
  for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' } as never)
  await w.clock.settle()
  expect(w.toasts).toEqual(['g-line hidden, and quiet until /g-line on.'])
  expect(w.notes).toEqual([])
  expect(w.suggested).toEqual([])
})

test('a turn that fails the same tool twice and jumps the context leads its receipt with the failures', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`✻ ${e.props.word} for 1m 4s · done 3:45 PM`}</Text>
  })
  await start($)
  await turn($, w, 1)
  await $.turn.start({ text: 'go', turnId: 't2' })
  w.toolError = true
  await $.tool.call({ tool: 'Bash', command: 'npm test' } as never)
  await $.tool.call({ tool: 'Bash', command: 'npm test -- --watch=false' } as never)
  w.toolError = false
  w.usage.cost += 0.5
  w.usage.tokens += 90_000
  await $.turn.complete({ answer: 'done', durationMs: 64_000, isAborted: false, turnId: 't2',
    reason: 'answer', usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await $.session.append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice',
    origin: { kind: 'engine' }, uuid: 'line-2' } as never)
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-2',
    props: { word: 'Baked', durationMs: 64_000 }, viewport: { columns: 140, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: '2 failed Bash calls' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'API $0.50' })).toBeDefined()
  await ui.unmount()
})

test('the 0.4 command still answers for one release, and says the new name', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  await start($)
  const answer = await $.command.run({ command: 'glanceline', args: 'off' } as never)
  expect(answer).toEqual({})
  expect(w.toasts[0]).toMatch(/^glanceline is now g-line: use \/g-line/)
})

test('Pulse is off by default and fetches nothing; turned on, one static file feeds the spinner after 15 seconds', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  const fetched: string[] = []
  const feed = { schema: 1, generated_at: '2026-10-14T12:00:00Z', items: [
    { title: 'Claude Code 2.1.297 \u001b[31mreleased', url: 'https://github.com/anthropics/claude-code/releases', source: 'Claude Code releases' },
    { title: 'Not a link', url: 'javascript:alert(1)', source: 'x' },
  ] }
  on('http.fetch', ($, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(feed) } } as never
  })
  const suffixes: string[] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    suffixes.push(e.props.suffix)
    const { Text } = $.ui.resolve(e)
    return <Text>x</Text>
  })
  await start($)
  await w.clock.settle()
  expect(fetched).toEqual([])
  await $.command.run({ command: 'g-line', args: 'pulse' } as never)
  await w.clock.settle()
  expect(fetched).toEqual(['https://raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json'])
  await $.turn.start({ text: 'go', turnId: 't1' })
  const early = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Spinner', requestId: 'main',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' }, viewport: { columns: 160, rows: 40 } })
  expect(suffixes[suffixes.length - 1] ?? '').not.toMatch(/Claude Code 2\.1\.297/)
  await early.unmount()
  await w.clock.advance(16_000)
  const later = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Spinner', requestId: 'main',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' }, viewport: { columns: 160, rows: 40 } })
  const shown = suffixes[suffixes.length - 1] ?? ''
  // The headline, cleaned of its escape sequence, with its source; the bad link never shows.
  expect(shown).toMatch(/│ Claude Code 2\.1\.297 released \(Claude Code releases\)$/)
  expect(shown).not.toMatch(/\u001b/)
  await later.unmount()
})

test('Claude can read the figures only when claude_reads is on, as a JSON snapshot', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { claude_reads: true }
  const registered: string[] = []
  on('tool.register', ($, e) => {
    registered.push(e.name)
    return { value: { tool: `mcp__g-line__${e.name}` } } as never
  })
  await start($)
  expect(registered).toEqual(['status'])
  const answer = await $.tool.call({ tool: 'mcp__g-line__status', section: 'context' } as never) as unknown as { text: string }
  const body = JSON.parse(answer.text)
  expect(body.schema).toBe(1)
  expect(body.context.scope).toBe('main_session')
  expect(body.limits).toBeUndefined()
})
