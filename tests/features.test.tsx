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
  /** Answers a `process.run` itself; undefined leaves it to the git stand-in. */
  run?: (argv: readonly string[]) => unknown
}

/** Claude Code beneath the mod, with what each test needs to steer it. */
function world(on: On, stored: Record<string, unknown> = {}, kept?: Record<string, unknown>, env: Record<string, string> = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: NOW * 1000 }), toasts: [], notes: [], suggested: [], copied: [],
    usage: { cost: 1, tokens: 600_000, percent: 60, limits: [] }, agents: [], notifySent: true, toolError: false, writes: [],
  }
  mock.env(on, { HOME: '/home/someone', ...env })
  if (kept) {
    // A store the test reads back: what the mod saved, as it saved it.
    on('store.get', ($, e) => ({ value: kept[e.key] }) as never)
    on('store.set', ($, e) => {
      kept[e.key] = e.value
      return { value: undefined } as never
    })
    on('store.delete', ($, e) => {
      delete kept[(e as unknown as { key: string }).key]
      return { value: undefined } as never
    })
    on('store.keys', () => ({ value: Object.keys(kept) }) as never)
  } else mock.store(on, stored)
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
  on('process.run', ($, e) => (w.run?.(e.argv)
    ?? (e.argv[0] === 'uname' ? { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '' } } : undefined)
    ?? { value: { exitCode: 0, stdout: '## feat/secret-branch\n', stderr: '' } }) as never)
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

test('an account reading that fails or runs out of time keeps the last one and is tried again within a minute', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { account_command: ['acct'] }
  let answer: 'seat' | 'slow' | 'other' = 'seat'
  let calls = 0
  w.run = argv => {
    if (argv[0] !== 'acct') return undefined
    calls += 1
    if (answer === 'slow') throw new Error('timed out after 5000 ms')
    return { value: { exitCode: 0, stdout: `account ${answer}@example.com (via CAAM)\n`, stderr: '' } }
  }
  const shown = async () => {
    await $.command.run({ command: 'g-line', args: '' } as never)
    const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
      props: { bodyColumns: 90 } as never, viewport: { columns: 160, rows: 50 } })
    const text = (await pane.find({ type: 'Text', text: /@example\.com/ }))?.text
    await pane.unmount()
    return text
  }
  await start($)
  expect(await shown()).toBe('account seat@example.com (via CAAM)')
  answer = 'slow'
  await w.clock.advance(10 * 60 * 1000)
  expect(await shown()).toBe('account seat@example.com (via CAAM)')
  const missed = calls
  answer = 'other'
  await w.clock.advance(60 * 1000)
  expect(calls).toBeGreaterThan(missed)
  expect(await shown()).toBe('account other@example.com (via CAAM)')
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

test('Pulse is off by default and fetches nothing; turned on in the receipts-only layout, one static file feeds the spinner after 15 seconds', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { lines: 'receipts' }
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

test('with a footer, Pulse keeps to its row: the spinner shows no headline, so only one moves at a time', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { pulse: true }
  feedServer(on)
  const suffixes: string[] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    suffixes.push(e.props.suffix)
    const { Text } = $.ui.resolve(e)
    return <Text>x</Text>
  })
  await start($)
  await w.clock.settle()
  await $.turn.start({ text: 'go', turnId: 't1' })
  await w.clock.advance(16_000)
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Spinner', requestId: 'main',
    props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' }, viewport: { columns: 160, rows: 40 } })
  expect(suffixes[suffixes.length - 1] ?? '').not.toMatch(/│/)
  await ui.unmount()
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

test('a compaction resets the cache figure: until the next turn writes the summary, it is not a cold rebuild of the old conversation', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { claude_reads: true }
  on('tool.register', ($, e) => ({ value: { tool: `mcp__g-line__${e.name}` } }) as never)
  on('session.compact', () => ({ messages: SUMMARY, tokensBefore: 204_000, tokensAfter: 31_000 }) as never)
  let write = 4_000
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [],
      usage: { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 200_000 - write, cache_creation_input_tokens: write } }
  } as never)
  const step = async (n: number) => {
    const stream = $.turn.step({ turnId: `t${n}`, index: 0, model: 'claude-opus-5-5', messageCount: 2 } as never)
    for await (const _ of stream) { /* drain */ }
    await stream.result
  }
  const cache = async () => {
    const answer = await $.tool.call({ tool: 'mcp__g-line__status', section: 'cache' } as never) as unknown as { text: string }
    return JSON.parse(answer.text).cache
  }
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step(1)
  expect((await cache()).state).toBe('estimated_warm')
  await w.clock.advance(2 * 3600 * 1000)
  expect(await cache()).toEqual(expect.objectContaining({ state: 'estimated_cold', rebuild_tokens_if_cold: 200_304 }))
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  expect(await cache()).toEqual(expect.objectContaining({ state: 'compacted', rebuild_tokens_if_cold: 31_000 }))
  write = 31_000
  await $.turn.start({ text: 'back', turnId: 't2' })
  await step(2)
  expect(await cache()).toEqual(expect.objectContaining({ state: 'estimated_warm', rebuild_tokens_if_cold: 200_304 }))
})

test('a context count that falls by half with no request between reads as a compaction, even unannounced', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { claude_reads: true }
  on('tool.register', ($, e) => ({ value: { tool: `mcp__g-line__${e.name}` } }) as never)
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [],
      usage: { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 196_000, cache_creation_input_tokens: 4_000 } }
  } as never)
  await start($)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 2 } as never)
  for await (const _ of stream) { /* drain */ }
  await stream.result
  await $.session.measure({ changed: ['context'], context: { tokens: 180_000, window: 1_000_000, percent: 18 }, rateLimits: [] } as never)
  const read = async () => JSON.parse((await $.tool.call({ tool: 'mcp__g-line__status', section: 'cache' } as never) as unknown as { text: string }).text).cache
  expect((await read()).state).toBe('estimated_warm')
  await $.session.measure({ changed: ['context'], context: { tokens: 28_000, window: 1_000_000, percent: 3 }, rateLimits: [] } as never)
  expect(await read()).toEqual(expect.objectContaining({ state: 'compacted', rebuild_tokens_if_cold: 28_000 }))
})

test('a compaction no event reports, while the context count stands still, reads as one once the idle conversation shrinks', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { claude_reads: true }
  on('tool.register', ($, e) => ({ value: { tool: `mcp__g-line__${e.name}` } }) as never)
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [],
      usage: { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 211_000, cache_creation_input_tokens: 4_000 } }
  } as never)
  let conversation = Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: [] }))
  let reads = 0
  on('session.messages', () => {
    reads += 1
    return { value: conversation } as never
  })
  await start($)
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 2 } as never)
  for await (const _ of stream) { /* drain */ }
  await stream.result
  const read = async () => JSON.parse((await $.tool.call({ tool: 'mcp__g-line__status', section: 'cache' } as never) as unknown as { text: string }).text).cache
  await w.clock.advance(4 * 60 * 1000)
  expect(reads).toBeGreaterThan(0)
  expect((await read()).state).toBe('estimated_warm')
  conversation = [{ role: 'user', content: [] }]
  await w.clock.advance(60 * 60 * 1000)
  expect(await read()).toEqual(expect.objectContaining({ state: 'compacted', rebuild_tokens_if_cold: null }))
  expect(w.toasts.filter(t => t.includes('cold'))).toEqual([])
})

test('the settings view lists every setting with its origin; a key press applies it now and keeps it', { timeoutMs: 30_000 }, async ($, on) => {
  const store: Record<string, unknown> = {}
  const w = world(on, {}, store)
  w.config = { git: true }
  await start($)
  await $.command.run({ command: 'g-line', args: 'settings' } as never)
  const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
    props: { bodyColumns: 130 } as never, viewport: { columns: 160, rows: 60 } })
  expect(await pane.find({ type: 'Text', text: /^• config\.json · the branch on line 2$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^  default · a notification when a background agent ends$/ })).toBeDefined()
  await pane.press({ key: 'set-notify.agents' })
  await w.clock.settle()
  expect(await pane.find({ type: 'Text', text: /^• your choice · a notification when a background agent ends$/ })).toBeDefined()
  // Kept for later sessions, in the same spelling as config.json.
  expect(store.settings).toEqual({ notify: { agents: true } })
  await pane.unmount()
})

test('/g-line set changes a setting at once and says so; reset hands it back to the files', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { spinner: true }
  const suffixes: string[] = []
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    suffixes.push(e.props.suffix)
    const { Text } = $.ui.resolve(e)
    return <Text>x</Text>
  })
  const spin = async () => {
    const m = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Spinner', requestId: 'main',
      props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' }, viewport: { columns: 160, rows: 40 } })
    const last = suffixes[suffixes.length - 1] ?? ''
    await m.unmount()
    return last
  }
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/work/a.ts' } as never)
  expect(await spin()).toMatch(/1 tool/)
  expect(await $.command.run({ command: 'g-line', args: 'set spinner off' } as never)).toEqual({})
  expect(w.toasts[w.toasts.length - 1]).toBe('Spinner extras: off.')
  expect(await spin()).not.toMatch(/tool/)
  await $.command.run({ command: 'g-line', args: 'reset spinner' } as never)
  expect(w.toasts[w.toasts.length - 1]).toBe('Spinner extras: on, from config.json.')
  expect(await spin()).toMatch(/1 tool/)
  await $.command.run({ command: 'g-line', args: 'set warp on' } as never)
  expect(w.toasts[w.toasts.length - 1]).toMatch(/^g-line has no setting "warp"/)
})

test('an edit to ~/.config/g-line/config.json reaches a running session on the beat', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  let mtime = 1
  on('fs.stat', () => ({ value: { kind: 'file', size: 10, mtimeMs: mtime, isLink: false } }) as never)
  const fetched: string[] = []
  on('http.fetch', ($, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: '{"schema":1,"items":[]}' } } as never
  })
  await start($)
  await w.clock.settle()
  expect(fetched).toEqual([])
  w.config = { pulse: true }
  mtime = 2
  await w.clock.advance(31_000)
  await w.clock.settle()
  expect(fetched).toEqual(['https://raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json'])
})

test('claude_reads turned on mid-session registers the status tool; turned off, the tool says so', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  const registered: string[] = []
  on('tool.register', ($, e) => {
    registered.push(e.name)
    return { value: { tool: `mcp__g-line__${e.name}` } } as never
  })
  await start($)
  expect(registered).toEqual([])
  await $.command.run({ command: 'g-line', args: 'set claude_reads on' } as never)
  expect(registered).toEqual(['status'])
  expect(w.toasts[w.toasts.length - 1]).toMatch(/^Claude reads: on\. Claude can call/)
  await $.command.run({ command: 'g-line', args: 'set status off' } as never)
  const answer = await $.tool.call({ tool: 'mcp__g-line__status' } as never) as unknown as { text: string }
  expect(JSON.parse(answer.text).state).toBe('disabled')
})

test('/g-line set all on turns every toggle on; reset clears the choices', { timeoutMs: 30_000 }, async ($, on) => {
  const store: Record<string, unknown> = {}
  const w = world(on, {}, store)
  on('tool.register', ($, e) => ({ value: { tool: `mcp__g-line__${e.name}` } }) as never)
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"schema":1,"items":[]}' } }) as never)
  await start($)
  await $.command.run({ command: 'g-line', args: 'set all on' } as never)
  expect(store.settings).toEqual({ spinner: true, footer_labels: true, short_hints: true, git: true, toasts: true,
    notify: { cache: true, reset: true, long_turn: true, agents: true }, pulse: true, coach: true, claude_reads: true, export_state: true })
  await $.command.run({ command: 'g-line', args: 'reset' } as never)
  expect(store.settings).toEqual({})
  expect(w.toasts[w.toasts.length - 1]).toMatch(/^Choices made with \/g-line cleared/)
})

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const FEED = { schema: 1, generated_at: ISO(NOW - 3600), items: [
  { title: 'Claude Dashboards are in beta', url: 'https://x.com/claudeai/status/1', source: '𝕏 @claudeai', published_at: ISO(NOW - 7200),
    text: `Claude Dashboards are in beta today. ${ESC}]8;;https://evil.example${BEL}Build${ESC}]8;;${BEL} a live view of anything.`,
    likes: 4200, author_name: 'Claude', story: 'Anthropic ships Dashboards' },
  { title: 'Claude Code 2.1.301 released', url: 'https://github.com/anthropics/claude-code/releases', source: 'Claude Code releases',
    published_at: ISO(NOW - 4 * 3600) },
  { title: 'Older news', url: 'https://example.com/old', source: 'Hacker News', published_at: ISO(NOW - 2 * 86_400),
    points: 254, discussion: 'https://news.ycombinator.com/item?id=1' },
] }

/** The feed's server, and the engine's hint line for Pulse's row to sit under. */
function feedServer(on: On) {
  const fetched: string[] = []
  on('http.fetch', ($, e) => {
    fetched.push(e.url)
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(FEED) } } as never
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
  return fetched
}

const HINT_PROPS = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

test('turned on, Pulse shows a headline under the prompt at once: who, how old, and the headline as a link', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on, {}, undefined, { TERM_PROGRAM: 'ghostty' })
  feedServer(on)
  await start($)
  const hint = async (columns: number) => $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: HINT_PROPS as never, viewport: { columns, rows: 40 } })
  let ui = await hint(160)
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  await ui.unmount()
  await $.command.run({ command: 'g-line', args: 'set pulse on' } as never)
  await w.clock.settle()
  ui = await hint(160)
  expect(await ui.find({ type: 'Text', text: '𝕏 @claudeai · 2h: ' })).toBeDefined()
  expect(await ui.find({ type: 'Link', text: 'Claude Dashboards are in beta' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' · /g-line news' })).toBeDefined()
  await ui.unmount()
  // Every 8 seconds, the next item.
  await w.clock.advance(8_000)
  ui = await hint(160)
  expect(await ui.find({ type: 'Link', text: 'Claude Code 2.1.301 released' })).toBeDefined()
  await ui.unmount()
  // Too narrow for a headline worth reading: no row.
  ui = await hint(30)
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  await ui.unmount()
  // `/g-line open` opens the one shown, or copies it where no browser can open.
  await $.command.run({ command: 'g-line', args: 'open' } as never)
  expect(w.toasts[w.toasts.length - 1]).toMatch(/^Opened github\.com in your browser\.$/)
})

test('where Claude Code draws no links (herdr), the headline is plain text, said once; FORCE_HYPERLINK makes it a link', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on, {}, undefined, { TERM_PROGRAM: 'herdr', HERDR_ENV: '1' })
  w.config = { pulse: true }
  feedServer(on)
  await start($)
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: HINT_PROPS as never, viewport: { columns: 160, rows: 40 } })
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Claude Dashboards are in beta' })).toBeDefined()
  await ui.unmount()
  expect(w.toasts.filter(text => text.includes('FORCE_HYPERLINK=1')).length).toBe(1)
  await w.clock.advance(16_000)
  expect(w.toasts.filter(text => text.includes('FORCE_HYPERLINK=1')).length).toBe(1)
  // The reader prints the whole address once, for the terminal to find, instead of a link it would print twice.
  await $.command.run({ command: 'g-line', args: 'news' } as never)
  const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
    props: { bodyColumns: 90 } as never, viewport: { columns: 160, rows: 60 } })
  expect(await pane.find({ type: 'Link' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'https://x.com/claudeai/status/1' })).toBeDefined()
  await pane.unmount()
})

test('after one pass through the feed the row holds still, and a headline comes back only after its 30-minute rest', { timeoutMs: 30_000 }, async ($, on) => {
  const kept: Record<string, unknown> = {}
  const w = world(on, {}, kept, { TERM_PROGRAM: 'ghostty' })
  w.config = { pulse: true }
  feedServer(on)
  await start($)
  await w.clock.settle()
  const row = async () => {
    const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
      props: HINT_PROPS as never, viewport: { columns: 160, rows: 40 } })
    const link = await ui.find({ type: 'Link' })
    await ui.unmount()
    return link?.text
  }
  const seen = [await row()]
  for (let i = 0; i < 2; i++) {
    await w.clock.advance(8_000)
    seen.push(await row())
  }
  expect(new Set(seen).size).toBe(3)
  // Every headline shown: the third holds, minute after minute.
  for (let i = 0; i < 10; i++) {
    await w.clock.advance(60_000)
    expect(await row()).toBe(seen[2])
  }
  // The counts are kept for every session on the machine.
  expect(Object.keys(kept.pulse_shown as object).length).toBe(3)
  // Past the rest, the one shown longest ago comes back.
  await w.clock.advance(19 * 60_000 + 50_000)
  expect(await row()).toBe(seen[0])
})

test('inside tmux 3.4, which passes links on, the headline is a link as Claude Code draws one', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on, {}, undefined, { TERM_PROGRAM: 'tmux', TERM_PROGRAM_VERSION: '3.4', TMUX: '/tmp/tmux-1/default,1,0' })
  w.config = { pulse: true }
  feedServer(on)
  await start($)
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: HINT_PROPS as never, viewport: { columns: 160, rows: 40 } })
  expect(await ui.find({ type: 'Link', text: 'Claude Dashboards are in beta' })).toBeDefined()
  await ui.unmount()
})

test('on a Linux box with no display (a herdr server reached over SSH), /g-line open copies the link instead of opening nothing', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on, {}, undefined, { HERDR_ENV: '1' })
  const ran: string[] = []
  w.run = argv => {
    ran.push(argv[0] ?? '')
    return argv[0] === 'uname' ? { value: { exitCode: 0, stdout: 'Linux\n', stderr: '' } } : undefined
  }
  w.config = { pulse: true }
  feedServer(on)
  await start($)
  await w.clock.settle()
  await $.command.run({ command: 'g-line', args: 'open' } as never)
  expect(ran).not.toContain('xdg-open')
  expect(ran).not.toContain('open')
  expect(w.copied).toEqual(['https://x.com/claudeai/status/1'])
  expect(w.toasts[w.toasts.length - 1]).toBe('Link copied (no browser opens on this machine): https://x.com/claudeai/status/1')
})

test('Pulse slow moves on every 40 seconds, paused not at all; the reader still pages', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on, {}, undefined, { TERM_PROGRAM: 'ghostty' })
  w.config = { pulse: true, pulse_speed: 'slow' }
  feedServer(on)
  await start($)
  await w.clock.settle()
  const shown = async () => {
    const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
      props: HINT_PROPS as never, viewport: { columns: 160, rows: 40 } })
    const link = await ui.find({ type: 'Link' })
    await ui.unmount()
    return link?.text
  }
  const first = await shown()
  await w.clock.advance(8_000)
  expect(await shown()).toBe(first)
  await w.clock.advance(32_000)
  expect(await shown()).not.toBe(first)
  await $.command.run({ command: 'g-line', args: 'set pulse_speed paused' } as never)
  const held = await shown()
  await w.clock.advance(120_000)
  expect(await shown()).toBe(held)
})

test('m in the reader mutes the picked source on the row, keeps it listed as muted, and m again brings it back', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on, {}, undefined, { TERM_PROGRAM: 'ghostty' })
  w.config = { pulse: true }
  feedServer(on)
  await start($)
  await w.clock.settle()
  const row = async () => {
    const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
      props: HINT_PROPS as never, viewport: { columns: 160, rows: 40 } })
    const link = await ui.find({ type: 'Link' })
    await ui.unmount()
    return link?.text
  }
  expect(await row()).toBe('Claude Dashboards are in beta')
  await $.command.run({ command: 'g-line', args: 'news' } as never)
  const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
    props: { bodyColumns: 90 } as never, viewport: { columns: 160, rows: 60 } })
  await pane.press({ key: 'mute' })
  expect(w.toasts[w.toasts.length - 1]).toBe("Muted 𝕏 @claudeai on Pulse's row and spinner; m here unmutes it.")
  expect(await pane.find({ type: 'Text', text: ' muted' })).toBeDefined()
  for (let i = 0; i < 4; i++) {
    expect(await row()).not.toBe('Claude Dashboards are in beta')
    await w.clock.advance(8_000)
  }
  await pane.press({ key: 'mute' })
  expect(w.toasts[w.toasts.length - 1]).toBe('𝕏 @claudeai is back on Pulse.')
  expect(await pane.find({ type: 'Text', text: ' muted' })).toBeUndefined()
  await pane.unmount()
})

test('/g-line news lists every item in the feed\'s order, the picked one in full; j moves on', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on, {}, undefined, { TERM_PROGRAM: 'ghostty' })
  w.config = { pulse: true }
  feedServer(on)
  await start($)
  await w.clock.settle()
  expect(await $.command.run({ command: 'g-line', args: 'news' } as never)).toEqual({})
  const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
    props: { bodyColumns: 90 } as never, viewport: { columns: 160, rows: 60 } })
  expect(await pane.find({ type: 'Text', text: '3 items, best first · updated 1h ago' })).toBeDefined()
  // The picked item: who and when, then its whole text with the feed's escapes stripped, then its link.
  expect(await pane.find({ type: 'Text', text: '𝕏 Claude @claudeai · 2h · ♥ 4.2k' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Claude Dashboards are in beta today. Build a live view of anything.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: new RegExp(ESC) })).toBeUndefined()
  expect(await pane.find({ type: 'Link', text: 'x.com/claudeai/status/1' })).toBeDefined()
  // The others: the headline, then who and when.
  expect(await pane.find({ type: 'Text', text: 'Older news' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Hacker News · 2d · ▲ 254' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '↳ Anthropic ships Dashboards' })).toBeDefined()
  await pane.press({ key: 'next' })
  expect(await pane.find({ type: 'Text', text: 'Claude Code releases · 4h' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Claude Code 2.1.301 released' })).toBeDefined()
  await pane.press({ key: 'next' })
  expect(await pane.find({ type: 'Link', text: 'Comments on Hacker News' })).toBeDefined()
  await pane.press({ key: 'discussion' })
  expect(w.toasts[w.toasts.length - 1]).toBe('Opened news.ycombinator.com in your browser.')
  await pane.unmount()
})

// ------------------------------------------------------------------ guard

const GUARD = {
  rules: [
    { left: 20, effort: 'medium' },
    { left: 10, agents: 'sonnet' },
    { left: 5, stop: true, unless_reset_within: '1h' },
  ],
}

/** Claude Code beneath the guard: what each request, prompt and spawn arrived as at the bottom. */
function engineBelow(on: On) {
  const seen = { efforts: [] as unknown[], prompts: [] as string[], models: [] as (string | undefined)[], forks: 0 }
  on('prompt.submit', ($, e) => {
    seen.prompts.push(e.text)
    return { text: e.text }
  })
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number; effort?: unknown; model: string }) {
    seen.efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 10_000, model: e.model } }
  } as never)
  on('agent.spawn', ($, e) => {
    seen.models.push(e.model)
    return { model: e.model ?? 'claude-opus-5-5', agentId: `a${seen.models.length}` } as never
  })
  return seen
}

async function step($: Engine, turnId: string, index: number, effort: string, model = 'claude-opus-5-5') {
  const stream = $.turn.step({ turnId, index, model, effort, messageCount: 2 } as never)
  for await (const _ of stream) { /* drain */ }
  await stream.result
}

async function spawn($: Engine, type = 'general-purpose', model?: string) {
  await $.agent.spawn({ tool_use_id: 'tu', prompt: 'p', description: 'Look into it', subagentType: type, ...(model ? { model } : {}),
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as never)
}

async function measure($: Engine, w: World, percentUsed: number, resetsIn = 2 * 3600) {
  w.usage.limits = [{ kind: 'five_hour', percentUsed, resetsAt: ISO(Math.floor(w.clock.now() / 1000) + resetsIn) }]
  await $.session.measure({ context: { tokens: 100_000, window: 1_000_000, percent: 10 }, rateLimits: w.usage.limits,
    cost: { usd: 1 }, changed: ['rateLimits'] })
}

/** The engine's hint line, for line 2 to sit under. */
function hintBelow(on: On) {
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as never

test('the guard is off by default: at 3% left nothing is refused, lowered or moved', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  const seen = engineBelow(on)
  await start($)
  await measure($, w, 97)
  expect(await $.prompt.submit(typed('go on'))).toEqual({ text: 'go on' })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'xhigh')
  await spawn($)
  expect(seen.efforts).toEqual(['xhigh'])
  expect(seen.models).toEqual([undefined])
  expect(w.toasts.some(t => t.includes('guard'))).toBe(false)
})

test('a stop rule refuses new prompts with the window, what is left and the way past; once and pause let them through', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  const seen = engineBelow(on)
  hintBelow(on)
  await start($)
  await measure($, w, 96)
  await w.clock.advance(15_000)
  expect(w.toasts.filter(t => t.startsWith('g-line guard: new prompts stop (4% of the 5-hour window left)')).length).toBe(1)
  const refused = await $.prompt.submit(typed('go on'))
  expect(refused.drop).toMatch(/^g-line guard stopped this prompt: 4% of the 5-hour window left \(your rule: stop at 5%\)\. It resets at \d\d:\d\d, in 1h 59m\. \/g-line guard once/)
  expect(w.suggested[w.suggested.length - 1]).toBe('/g-line guard once')
  // A loop's or schedule's wakeup is refused too; a typed slash command and a delivery into a running turn are not.
  expect((await $.prompt.submit({ text: 'check CI', wait: false, origin: { kind: 'scheduled-trigger' } } as never)).drop).toBeDefined()
  expect((await $.prompt.submit({ text: '/compact', wait: false, origin: { kind: 'composer' }, command: { name: 'compact', args: '' } } as never)).drop).toBeUndefined()
  expect((await $.prompt.submit({ text: 'agent done', wait: false, origin: { kind: 'task-notification' }, turnId: 't9' } as never)).drop).toBeUndefined()
  await $.command.run({ command: 'g-line', args: 'guard once' } as never)
  expect(await $.prompt.submit(typed('just this one'))).toEqual({ text: 'just this one' })
  expect((await $.prompt.submit(typed('and this?'))).drop).toBeDefined()
  await $.command.run({ command: 'g-line', args: 'guard pause 30m' } as never)
  expect(await $.prompt.submit(typed('paused'))).toEqual({ text: 'paused' })
  await $.command.run({ command: 'g-line', args: 'guard resume' } as never)
  expect((await $.prompt.submit(typed('resumed'))).drop).toBeDefined()
  expect(seen.prompts).toEqual(['/compact', 'agent done', 'just this one', 'paused'])
  // Line 2 says so.
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 160, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: 'guard: stopped, 4% 5h left' })).toBeDefined()
  await ui.unmount()
  // Within the hour before the reset, the stop rule waits.
  await measure($, w, 97, 40 * 60)
  expect(await $.prompt.submit(typed('nearly reset'))).toEqual({ text: 'nearly reset' })
})

test('low on the window, the conversation runs at a lower effort and new subagents on Sonnet, and the receipt says so', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  const seen = engineBelow(on)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`✻ ${e.props.word} for 1m 4s`}</Text>
  })
  await start($)
  await measure($, w, 92)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'xhigh')
  await step($, 't1', 1, 'xhigh')
  await spawn($)
  await spawn($, 'Explore')
  await spawn($, 'general-purpose', 'haiku')
  // Effort only ever goes down: a request already at low stays there.
  expect(seen.efforts).toEqual(['medium', 'medium'])
  expect(seen.models).toEqual(['sonnet', undefined, 'haiku'])
  await $.turn.complete({ answer: 'done', durationMs: 64_000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await $.session.append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice',
    origin: { kind: 'engine' }, uuid: 'line-1' } as never)
  const line = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-1',
    props: { word: 'Baked', durationMs: 64_000 }, viewport: { columns: 160, rows: 40 } })
  expect(await line.find({ type: 'Text', text: 'guard: effort medium, 1 agent on a cheaper model' })).toBeDefined()
  await line.unmount()
  // The window resets: effort is the person's again, said once.
  await measure($, w, 3, 5 * 3600)
  await w.clock.advance(15_000)
  expect(w.toasts.filter(t => t.includes('effort is yours again')).length).toBe(1)
  await $.turn.start({ text: 'go', turnId: 't2' })
  await step($, 't2', 0, 'xhigh')
  expect(seen.efforts[seen.efforts.length - 1]).toBe('xhigh')
})

test('where a change of effort would rebuild the cache, the guard waits for the cache to go cold', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  const seen = engineBelow(on)
  hintBelow(on)
  await start($)
  await measure($, w, 50)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high', 'claude-opus-5')
  await measure($, w, 85)
  await $.turn.start({ text: 'go', turnId: 't2' })
  await step($, 't2', 0, 'high', 'claude-opus-5')
  expect(seen.efforts).toEqual(['high', 'high'])
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: 'guard: effort medium when cache cold' })).toBeDefined()
  await ui.unmount()
  await w.clock.advance(2 * 3600 * 1000)
  await measure($, w, 85)
  await $.turn.start({ text: 'back', turnId: 't3' })
  await step($, 't3', 0, 'high', 'claude-opus-5')
  expect(seen.efforts[2]).toBe('medium')
})

test('a model other than the one asked for answers: the receipt says which', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 9000, model: 'claude-sonnet-5-5' } }
  } as never)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`✻ ${e.props.word}`}</Text>
  })
  await start($)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high', 'claude-opus-5-5[1m]')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-sonnet-5-5' } })
  await $.session.append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice',
    origin: { kind: 'engine' }, uuid: 'line-1' } as never)
  const line = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-1',
    props: { word: 'Baked', durationMs: 4000 }, viewport: { columns: 160, rows: 40 } })
  expect(await line.find({ type: 'Text', text: 'answered by Sonnet 5.5' })).toBeDefined()
  await line.unmount()
  void w
})

test('keep-warm re-reads an idle hour-long cache at about 45 minutes, says so, and stops at its limit', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { keep_warm: { after: '45m', max: 2, min_context: '50k' } } }
  engineBelow(on)
  hintBelow(on)
  const forks: string[] = []
  on('model.fork', ($, e) => {
    forks.push(e.prompt)
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 } } } as never
  })
  await start($)
  await measure($, w, 40)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await w.clock.advance(40 * 60_000)
  expect(forks.length).toBe(0)
  await w.clock.advance(9 * 60_000)
  expect(forks.length).toBe(1)
  expect(forks[0]).toMatch(/automatic keep-alive from the g-line plugin/)
  expect(w.toasts.filter(t => t.startsWith('Kept the cache warm: re-read 100k')).length).toBe(1)
  // The countdown starts over from the re-read: still warm well past the first hour.
  await w.clock.advance(30 * 60_000)
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: /^cache warm/ })).toBeDefined()
  await ui.unmount()
  await w.clock.advance(60 * 60_000)
  expect(forks.length).toBe(2)
  await w.clock.advance(120 * 60_000)
  expect(forks.length).toBe(2)
})

test('keep-warm stops for the session when its re-read finds no cache', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { keep_warm: true } }
  engineBelow(on)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 100_000 } } } as never
  })
  await start($)
  await measure($, w, 40)
  const turnOf = async (id: string) => {
    await $.turn.start({ text: 'go', turnId: id })
    await step($, id, 0, 'high')
    await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: id, reason: 'answer',
      usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  }
  await turnOf('t1')
  await w.clock.advance(50 * 60_000)
  expect(forks).toBe(1)
  expect(w.toasts.filter(t => t.startsWith('Keep-warm stopped for this session: its re-read found no cache (read 0, wrote 100k)')).length).toBe(1)
  await turnOf('t2')
  await w.clock.advance(50 * 60_000)
  expect(forks).toBe(1)
})

test('keep-warm stands aside where Claude Code compacts an idle conversation itself', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { keep_warm: true } }
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 240_000, cache_creation_input_tokens: 10_000, model: 'claude-opus-5-5' } }
  } as never)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 250_000, cache_creation_input_tokens: 0 } } } as never
  })
  await start($)
  await measure($, w, 40)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await w.clock.advance(55 * 60_000)
  expect(forks).toBe(0)
})
