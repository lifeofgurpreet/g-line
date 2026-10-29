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
  /** Files `$.fs.read` finds, by path; `rm -f` takes one away. */
  files: Record<string, string>
  /** What `$.session.model()` answers; Opus 5.5 when unset. */
  model?: string
  /** Answers a `process.run` itself; undefined leaves it to the git stand-in. */
  run?: (argv: readonly string[]) => unknown
}

/** Claude Code beneath the mod, with what each test needs to steer it. */
function world(on: On, stored: Record<string, unknown> = {}, kept?: Record<string, unknown>, env: Record<string, string> = {}): World {
  const w: World = {
    clock: mock.clock(on, { now: NOW * 1000 }), toasts: [], notes: [], suggested: [], copied: [],
    usage: { cost: 1, tokens: 600_000, percent: 60, limits: [] }, agents: [], notifySent: true, toolError: false, writes: [],
    files: {},
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
  on('session.model', () => ({ value: w.model ?? 'claude-opus-5-5' }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', ($, e) => (w.run?.(e.argv)
    ?? (e.argv[0] === 'rm' ? (delete w.files[String(e.argv[e.argv.length - 1])], { value: { exitCode: 0, stdout: '', stderr: '' } }) : undefined)
    ?? (e.argv[0] === 'uname' ? { value: { exitCode: 0, stdout: 'Darwin\n', stderr: '' } } : undefined)
    ?? { value: { exitCode: 0, stdout: '## feat/secret-branch\n', stderr: '' } }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('fs.read', ($, e) => (w.files[e.path] !== undefined ? { value: w.files[e.path] }
    : w.config !== undefined && /\/(g-line|glanceline)\/config\.json$/.test(e.path)
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
  expect(w.toasts.some(t => t.startsWith('◆ context compacts in ~'))).toBe(true)
  expect(w.suggested).toContain('/compact keep ')
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  expect(w.toasts).toContain('◆ context compacted · 912k → 31k')
  // The same heads-up again within ten minutes is no news; after that it is said again.
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  expect(w.toasts.filter(t => t === '◆ context compacted · 912k → 31k').length).toBe(1)
  await w.clock.advance(11 * 60_000)
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  expect(w.toasts.filter(t => t === '◆ context compacted · 912k → 31k').length).toBe(2)
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
    return { value: { exitCode: 0, stdout: `account ${answer}@example.com (via my-accounts)\n`, stderr: '' } }
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
  expect(await shown()).toBe('account seat@example.com (via my-accounts)')
  answer = 'slow'
  await w.clock.advance(10 * 60 * 1000)
  expect(await shown()).toBe('account seat@example.com (via my-accounts)')
  const missed = calls
  answer = 'other'
  await w.clock.advance(60 * 1000)
  expect(calls).toBeGreaterThan(missed)
  expect(await shown()).toBe('account other@example.com (via my-accounts)')
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
  expect(store.settings).toEqual({ spinner: true, footer_labels: true, short_hints: true, git: true, roster: true, toasts: true,
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
  expect(w.toasts[w.toasts.length - 1]).toMatch(/^◆ opened github\.com in your browser$/)
  // In the fullscreen terminal, where Claude Code reports clicks, the headline is g-line's own
  // control: a plain click opens it, whatever the terminal does with links.
  const opened = w.toasts.length
  ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: HINT_PROPS as never, viewport: { columns: 160, rows: 40, isFullscreen: true } as never })
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  await ui.press({ key: 'pulse-open' })
  expect(w.toasts.length).toBe(opened + 1)
  expect(w.toasts[w.toasts.length - 1]).toMatch(/^◆ opened \S+ in your browser$/)
  await ui.unmount()
})

test('0.12.1: with Pulse on in an interactive session, g-line asks for links in Claude Code\'s own process', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { pulse: true }
  const set: [string, unknown][] = []
  on('env.set', ($, e) => {
    set.push([(e as unknown as { name: string }).name, (e as unknown as { value: unknown }).value])
    return { value: {} } as never
  })
  await start($)
  expect(set).toEqual([['FORCE_HYPERLINK', '1']])
})

test('0.12.1: Pulse off, nothing is set', { timeoutMs: 30_000 }, async ($, on) => {
  world(on)
  const set: unknown[] = []
  on('env.set', ($, e) => {
    set.push(e)
    return { value: {} } as never
  })
  await start($)
  expect(set).toEqual([])
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
  expect(w.toasts.filter(text => text.includes('FORCE_HYPERLINK=0')).length).toBe(1)
  await w.clock.advance(16_000)
  expect(w.toasts.filter(text => text.includes('FORCE_HYPERLINK=0')).length).toBe(1)
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
  expect(w.toasts[w.toasts.length - 1]).toBe('◆ link to x.com copied · no browser opens on this machine, so paste it in your browser')
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
  expect(w.toasts[w.toasts.length - 1]).toBe('◆ opened news.ycombinator.com in your browser')
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

async function stepResult($: Engine, turnId: string, index: number) {
  const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', effort: 'high', messageCount: 2 + index * 2 } as never) as unknown as AsyncIterator<unknown, unknown>
  let r = await stream.next()
  while (!r.done) r = await stream.next()
  const v = r.value as { value?: unknown } | undefined
  return ((v && 'value' in v ? v.value : v) ?? {}) as { usage: unknown; toolUses: unknown[] }
}

test('0.9.0: a stop with end_turn ends a running turn before its next request once the rule starts mid-turn; a plain stop never does', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { rules: [{ left: 10, stop: true, end_turn: true }] } }
  const seen = engineBelow(on)
  const aborted: string[] = []
  on('turn.abort', ($, e) => {
    aborted.push((e as unknown as { turnId: string }).turnId)
    return { value: undefined } as never
  })
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`✻ ${e.props.word} for 1m 4s`}</Text>
  })
  hintBelow(on)
  await start($)
  await measure($, w, 50)
  await w.clock.advance(15_000)
  await $.turn.start({ text: 'go', turnId: 't1' })
  expect((await stepResult($, 't1', 0)).usage).not.toBeNull()
  // The window falls past the rule while the turn runs: the next step makes no request.
  await measure($, w, 92)
  const ended = await stepResult($, 't1', 1)
  expect(ended.usage).toBeNull()
  expect(ended.toolUses).toEqual([])
  expect(seen.efforts).toEqual(['high'])
  expect(aborted).toEqual(['t1'])
  expect(w.toasts.some(t => /^g-line ended this turn before its next request: 8% of the 5-hour window left, at or under your 10% stop\. It resets at \d\d:\d\d, in 2h 0m\. To carry on anyway, type "continue" and press Enter twice\.$/.test(t))).toBe(true)
  await $.turn.complete({ answer: '', durationMs: 64_000, isAborted: true, turnId: 't1', reason: 'aborted',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } } as never)
  await $.session.append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice',
    origin: { kind: 'engine' }, uuid: 'line-t1' } as never)
  const line = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-t1',
    props: { word: 'Worked' } as never, viewport: { columns: 200, rows: 5 } })
  expect(await line.find({ type: 'Text', text: /guard: ended the turn, 8% 5h left/ })).toBeDefined()
  await line.unmount()
  // A turn let through with the rule in force (once) runs to its end.
  await $.command.run({ command: 'g-line', args: 'guard once' } as never)
  expect(await $.prompt.submit(typed('continue'))).toEqual({ text: 'continue' })
  await $.turn.start({ text: 'continue', turnId: 't2' })
  expect((await stepResult($, 't2', 0)).usage).not.toBeNull()
  expect((await stepResult($, 't2', 1)).usage).not.toBeNull()
  expect(aborted).toEqual(['t1'])
})

test('0.9.0: without end_turn, or while paused, a turn runs on past a stop rule', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { rules: [{ left: 10, stop: true }] } }
  const seen = engineBelow(on)
  const aborted: string[] = []
  on('turn.abort', ($, e) => {
    aborted.push((e as unknown as { turnId: string }).turnId)
    return { value: undefined } as never
  })
  await start($)
  await measure($, w, 50)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await stepResult($, 't1', 0)
  await measure($, w, 95)
  expect((await stepResult($, 't1', 1)).usage).not.toBeNull()
  expect(seen.efforts.length).toBe(2)
  expect(aborted).toEqual([])
  // end_turn, but paused: runs on.
  w.config = { guard: { rules: [{ left: 10, stop: true, end_turn: true }] } }
  await w.clock.advance(31_000)
  await $.command.run({ command: 'g-line', args: 'guard pause 30m' } as never)
  await measure($, w, 50)
  await $.turn.start({ text: 'go', turnId: 't2' })
  await stepResult($, 't2', 0)
  await measure($, w, 95)
  expect((await stepResult($, 't2', 1)).usage).not.toBeNull()
  expect(aborted).toEqual([])
})

test('0.11.0: with guard.queue a typed prompt the guard holds is sent on its own once the guard lets go', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { rules: [{ left: 10, stop: true }], queue: true } }
  const seen = engineBelow(on)
  hintBelow(on)
  await start($)
  await measure($, w, 95)
  await w.clock.advance(15_000)
  const held = await $.prompt.submit(typed('finish the report'))
  expect(held.drop).toMatch(/Queued for about \d\d:\d\d.*; Enter again sends it now\.$/)
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: /guard: held, 5% 5h left till \d\d:\d\d, 1 queued/ })).toBeDefined()
  await ui.unmount()
  // Still held: nothing goes.
  await w.clock.advance(15_000)
  expect(seen.prompts).toEqual([])
  // The window resets: the next beat sends it, once.
  await measure($, w, 3, 5 * 3600)
  await w.clock.advance(15_000)
  expect(seen.prompts).toEqual(['finish the report'])
  expect(w.toasts.some(t => t === '◆ sent the prompt g-line was holding')).toBe(true)
  await w.clock.advance(30_000)
  expect(seen.prompts).toEqual(['finish the report'])
})

test('0.11.0: /g-line guard cancel drops a queued prompt', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { rules: [{ left: 10, stop: true }], queue: true } }
  const seen = engineBelow(on)
  await start($)
  await measure($, w, 95)
  await w.clock.advance(15_000)
  expect((await $.prompt.submit(typed('later please'))).drop).toBeDefined()
  await $.command.run({ command: 'g-line', args: 'guard cancel' } as never)
  await measure($, w, 3, 5 * 3600)
  await w.clock.advance(15_000)
  expect(seen.prompts).toEqual([])
  expect(w.toasts.some(t => t.startsWith('g-line won\'t send the prompt it was holding'))).toBe(true)
})

test('a stop rule refuses new prompts with the window, what is left and the way past; once and pause let them through', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  const seen = engineBelow(on)
  hintBelow(on)
  await start($)
  await measure($, w, 96)
  await w.clock.advance(15_000)
  expect(w.toasts.filter(t => t.startsWith('◆ guard · held: 4% of 5h left')).length).toBe(1)
  const refused = await $.prompt.submit(typed('go on'))
  expect(refused.drop).toMatch(/^g-line held this: 4% of the 5-hour window left, at or under your 5% stop\. Lifts at \d\d:\d\d, in 1h 59m\. Enter again sends it anyway/)
  // A loop's or schedule's wakeup is refused too; a typed slash command and a delivery into a running turn are not.
  expect((await $.prompt.submit({ text: 'check CI', wait: false, origin: { kind: 'scheduled-trigger' } } as never)).drop).toBeDefined()
  expect((await $.prompt.submit({ text: '/compact', wait: false, origin: { kind: 'composer' }, command: { name: 'compact', args: '' } } as never)).drop).toBeUndefined()
  expect((await $.prompt.submit({ text: 'agent done', wait: false, origin: { kind: 'task-notification' }, turnId: 't9' } as never)).drop).toBeUndefined()
  await $.command.run({ command: 'g-line', args: 'guard once' } as never)
  expect(await $.prompt.submit(typed('just this one'))).toEqual({ text: 'just this one' })
  expect((await $.prompt.submit(typed('and this?'))).drop).toBeDefined()
  // 0.9.1: the person sends the held prompt again, unchanged: it goes. A machine's repeat does not.
  expect(await $.prompt.submit(typed('and this?'))).toEqual({ text: 'and this?' })
  expect(w.toasts.some(t => t === '◆ sent anyway · 4% of the 5-hour window left')).toBe(true)
  expect((await $.prompt.submit(typed('and this?'))).drop).toBeDefined()
  expect((await $.prompt.submit(typed('something else'))).drop).toBeDefined()
  // A schedule held again in the same hold gets one line, not the whole story.
  expect((await $.prompt.submit({ text: 'check CI', wait: false, origin: { kind: 'scheduled-trigger' } } as never)).drop).toMatch(/^g-line: still held, lifts about \d\d:\d\d\.$/)
  await $.command.run({ command: 'g-line', args: 'guard pause 30m' } as never)
  expect(await $.prompt.submit(typed('paused'))).toEqual({ text: 'paused' })
  await $.command.run({ command: 'g-line', args: 'guard resume' } as never)
  expect((await $.prompt.submit(typed('resumed'))).drop).toBeDefined()
  // Off in this session alone: everything goes, line 2 says so, and on here brings the rule back.
  await $.command.run({ command: 'g-line', args: 'guard off here' } as never)
  expect(w.toasts.some(t => t.startsWith('g-line guard off in this session'))).toBe(true)
  expect(await $.prompt.submit(typed('mine'))).toEqual({ text: 'mine' })
  expect((await $.prompt.submit({ text: 'check CI', wait: false, origin: { kind: 'scheduled-trigger' } } as never)).drop).toBeUndefined()
  const here = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 160, rows: 40 } })
  expect(await here.find({ type: 'Text', text: /^guard off here$/ })).toBeDefined()
  await here.unmount()
  await $.command.run({ command: 'g-line', args: 'guard on here' } as never)
  expect((await $.prompt.submit(typed('guarded again'))).drop).toBeDefined()
  expect(seen.prompts).toEqual(['/compact', 'agent done', 'just this one', 'and this?', 'paused', 'mine', 'check CI'])
  // Line 2 says so.
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 160, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: /^guard: held, 4% 5h left till \d\d:\d\d$/ })).toBeDefined()
  await ui.unmount()
  // Within the hour before the reset, the stop rule waits.
  await measure($, w, 97, 40 * 60)
  expect(await $.prompt.submit(typed('nearly reset'))).toEqual({ text: 'nearly reset' })
})

test('low on the window, the conversation runs at a lower effort and new subagents on Sonnet, and the receipt says so', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  const seen = engineBelow(on)
  hintBelow(on)
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
  // Line 2 shows the effort set and the effort that ran.
  const hint = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  expect(await hint.find({ type: 'Text', text: /xhigh→medium/ })).toBeDefined()
  await hint.unmount()
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
  expect(w.toasts.filter(t => /^◆ cache kept warm · 100k re-read after 4\dm idle$/.test(t)).length).toBe(1)
  // The countdown starts over from the re-read: still warm well past the first hour.
  await w.clock.advance(30 * 60_000)
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: /^cache warm/ })).toBeDefined()
  await ui.unmount()
  await w.clock.advance(60 * 60_000)
  expect(forks.length).toBe(2)
  // Only the first re-read of an idle stretch is said; line 2 counts the rest.
  expect(w.toasts.filter(t => t.includes('cache kept warm')).length).toBe(1)
  await w.clock.advance(120 * 60_000)
  expect(forks.length).toBe(2)
})

test('0.20: a re-read that finds no cache ends the stretch; the second time keep-warm is off for the session', { timeoutMs: 30_000 }, async ($, on) => {
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
  // Once is the stretch's end, said nowhere: the next stretch tries again.
  expect(w.toasts.some(t => t.includes('keep-warm off'))).toBe(false)
  await turnOf('t2')
  await w.clock.advance(50 * 60_000)
  expect(forks).toBe(2)
  expect(w.toasts.filter(t => t === '◆ keep-warm off in this session · twice the kept cache was gone (a re-read wrote 100k of 100k)').length).toBe(1)
  await turnOf('t3')
  await w.clock.advance(50 * 60_000)
  expect(forks).toBe(2)
})

test('0.20: a re-read that gets no answer (an API error) is tried again, and keep-warm stays on', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { keep_warm: true } }
  engineBelow(on)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return forks <= 2
      ? { value: { isAnswered: false, reason: 'api-error' } } as never
      : { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 } } } as never
  })
  await start($)
  await measure($, w, 40)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await w.clock.advance(50 * 60_000)
  expect(forks).toBe(3)
  expect(w.toasts.filter(t => t.includes('cache kept warm')).length).toBe(1)
  expect(w.toasts.some(t => t.includes('keep-warm off'))).toBe(false)
})

test('0.20: a guard pause leaves keep-warm running, and a reading from before the 5-hour reset counts as a full window', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { keep_warm: true } }
  engineBelow(on)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 } } } as never
  })
  await start($)
  // 95% of the five hours used, resetting in 30 minutes: low now, a fresh window by the time the cache needs keeping.
  await measure($, w, 95, 30 * 60)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await $.command.run({ command: 'g-line', args: 'guard pause 2h' } as never)
  await w.clock.advance(50 * 60_000)
  expect(forks).toBe(1)
})

test('0.20: a cold rebuild says on its receipt why keep-warm did not keep the cache, and the day counts it', { timeoutMs: 30_000 }, async ($, on) => {
  const kept: Record<string, unknown> = {}
  const w = world(on, {}, kept)
  w.config = { guard: { keep_warm: { after: '45m', max: 1 } } }
  let lapsed = false
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    const usage = lapsed
      ? { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 120_000, model: 'claude-opus-5-5' }
      : { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 110_000, cache_creation_input_tokens: 10_000, model: 'claude-opus-5-5' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  } as never)
  on('model.fork', () => ({ value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 0 } } }) as never)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`✻ ${e.props.word}`}</Text>
  })
  const turnOf = async (id: string) => {
    await $.turn.start({ text: 'go', turnId: id })
    await step($, id, 0, 'high')
    await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: id, reason: 'answer',
      usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
    await $.session.append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice',
      origin: { kind: 'engine' }, uuid: `line-${id}` } as never)
  }
  await start($)
  await measure($, w, 40)
  await turnOf('t1')
  // One re-read allowed: the second hour has none left, so the cache lapses.
  await w.clock.advance(150 * 60_000)
  lapsed = true
  await turnOf('t2')
  const line = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-t2',
    props: { word: 'Baked', durationMs: 4000 }, viewport: { columns: 200, rows: 40 } })
  expect(await line.find({ type: 'Text', text: /cache cold · rebuilt 12\dk · out of re-reads/ })).toBeDefined()
  await line.unmount()
  await w.clock.advance(1000)
  const day = Object.entries(kept).find(([key]) => key.startsWith('d:'))?.[1] as { coldWhy?: Record<string, number> } | undefined
  expect(day?.coldWhy).toEqual({ 'out of re-reads': 1 })
})

/** A 120k conversation left idle for 150 minutes with one re-read allowed (`keepWarm` as written): the compactions that reached the engine. */
async function outOfRereads($: Engine, on: On, keepWarm: unknown) {
  const w = world(on, {})
  w.config = { guard: { keep_warm: keepWarm } }
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 110_000, cache_creation_input_tokens: 10_000, model: 'claude-opus-5-5' } }
  } as never)
  on('model.fork', () => ({ value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 0 } } }) as never)
  const triggers: string[] = []
  on('session.compact', ($, e) => {
    triggers.push((e as { trigger: string }).trigger)
    return { messages: SUMMARY, tokensBefore: 120_000, tokensAfter: 9_000 } as never
  })
  await start($)
  await measure($, w, 40)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await w.clock.advance(150 * 60_000)
  return triggers
}

test('0.21: out of re-reads, keep-warm compacts the idle conversation once, while its cache is still warm', { timeoutMs: 30_000 }, async ($, on) => {
  expect((await outOfRereads($, on, { after: '45m', max: 1 })).length).toBe(1)
})

test('0.21: with compact: false keep-warm lets the cache lapse as before', { timeoutMs: 30_000 }, async ($, on) => {
  expect((await outOfRereads($, on, { after: '45m', max: 1, compact: false })).length).toBe(0)
})

/** A 250k conversation idle for 55 minutes under keep-warm (`keepWarm` as written): how many re-reads it got. */
async function bigIdle($: Engine, on: On, stored: Record<string, unknown> = {}, account?: string, keepWarm: unknown = true) {
  const w = world(on, stored)
  w.config = account ? { guard: { keep_warm: keepWarm }, account_command: ['acct'] } : { guard: { keep_warm: keepWarm } }
  if (account) w.run = argv => (argv[0] === 'acct' ? { value: { exitCode: 0, stdout: `${account}\n`, stderr: '' } } : undefined)
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
  return forks
}

test('with compact: false keep-warm stands aside where Claude Code compacts an idle conversation itself', { timeoutMs: 30_000 }, async ($, on) => {
  // A session on this account was seen compacting while idle an hour ago.
  expect(await bigIdle($, on, { 'idle-compacts:machine': (NOW - 3600) * 1000 }, undefined, { compact: false })).toBe(0)
})

test('0.21: keep-warm holds a big conversation where Claude Code compacts idle ones, and stands that compaction down', { timeoutMs: 30_000 }, async ($, on) => {
  let compactions = 0
  on('session.compact', () => {
    compactions += 1
    return { messages: SUMMARY, tokensBefore: 250_000, tokensAfter: 20_000 } as never
  })
  expect(await bigIdle($, on, { 'idle-compacts:machine': (NOW - 3600) * 1000 })).toBe(1)
  // Claude Code's idle compaction comes about 54 minutes in: keep-warm re-read at 45, so it waits.
  const r = await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never) as { skip?: string }
  expect(r.skip).toContain('keep-warm')
  expect(compactions).toBe(0)
  // A person's own /compact is never stood down.
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  expect(compactions).toBe(1)
})

test('0.19.3: a sighting on another account leaves this account\'s big conversations to keep-warm', { timeoutMs: 30_000 }, async ($, on) => {
  // One machine, many accounts: Claude Code turns idle compaction on per account.
  expect(await bigIdle($, on, { 'idle-compacts:other@example.com': (NOW - 3600) * 1000 }, 'me@example.com')).toBe(1)
})

test('0.19.3: a sighting on this account still counts when the account is read', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await bigIdle($, on, { 'idle-compacts:me@example.com': (NOW - 3600) * 1000 }, 'me@example.com', { compact: false })).toBe(0)
})

test('0.19.3: the old machine-wide sighting no longer counts', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await bigIdle($, on, { 'idle-compaction-seen': (NOW - 3600) * 1000 })).toBe(1)
})

test('0.20: a sighting from before 0.20 (it may have been a /clear) no longer counts', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await bigIdle($, on, { 'idle-compaction-seen:machine': (NOW - 3600) * 1000 })).toBe(1)
})

/** A 300-message conversation shrunk to `left` while idle, after `/command` when given: the idle-compaction sightings it left. */
async function shrunkIdle($: Engine, on: On, left: number, command?: string) {
  const kept: Record<string, unknown> = {}
  const w = world(on, {}, kept)
  engineBelow(on)
  let conversation: unknown[] = Array.from({ length: 300 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: [] }))
  on('session.messages', () => ({ value: conversation }) as never)
  await start($)
  await measure($, w, 40)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await w.clock.advance(4 * 60_000)
  if (command) await $.command.run({ command, args: '' } as never).catch(() => undefined)
  conversation = conversation.slice(0, left)
  await w.clock.advance(10 * 60_000)
  // Any sighting, under 0.20's key or an older one.
  return Object.keys(kept).filter(key => key.startsWith('idle-compact'))
}

test('0.20: a conversation that shrank to a summary with nobody typing is an idle compaction', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await shrunkIdle($, on, 1)).toEqual(['idle-compacts:machine'])
})

test('0.20: /clear is no idle compaction', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await shrunkIdle($, on, 0, 'clear')).toEqual([])
})

test('0.20: an emptied conversation is no idle compaction, even unseen', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await shrunkIdle($, on, 0)).toEqual([])
})

test('0.20: /compact and /rewind while idle are the person\'s, not idle compaction', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await shrunkIdle($, on, 1, 'compact')).toEqual([])
})

test('0.20: /rewind while idle is no idle compaction', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await shrunkIdle($, on, 3, 'rewind')).toEqual([])
})

test('0.18.0: until an idle compaction is seen on this machine, keep-warm keeps a big conversation warm', { timeoutMs: 30_000 }, async ($, on) => {
  // Claude Code switches idle compaction on per account, out of sight: none seen, none counted on.
  expect(await bigIdle($, on)).toBe(1)
})

test('0.18.0: an idle compaction seen counts from then on, and an old sighting does not', { timeoutMs: 30_000 }, async ($, on) => {
  expect(await bigIdle($, on, { 'idle-compacts:machine': (NOW - 30 * 86_400) * 1000 })).toBe(1)
})

test('0.18.0: a compaction with no turn running records that Claude Code compacts idle conversations here', { timeoutMs: 30_000 }, async ($, on) => {
  const kept: Record<string, unknown> = {}
  const w = world(on, {}, kept)
  engineBelow(on)
  on('session.compact', ($, e) => ({ messages: SUMMARY, tokensBefore: 300_000, tokensAfter: 20_000 }) as never)
  await start($)
  await measure($, w, 40)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  expect(kept['idle-compacts:machine']).toBeUndefined()
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await $.session.compact({ trigger: 'manual', messages: SUMMARY } as never)
  expect(kept['idle-compacts:machine']).toBeUndefined()
  await $.session.compact({ trigger: 'auto', messages: SUMMARY } as never)
  expect(typeof kept['idle-compacts:machine']).toBe('number')
})

test('0.19.3: a big conversation that lapses uncompacted after an idle hour clears the sighting', { timeoutMs: 30_000 }, async ($, on) => {
  const kept: Record<string, unknown> = { 'idle-compacts:machine': (NOW - 3600) * 1000 }
  const w = world(on, {}, kept)
  w.config = { guard: { keep_warm: { compact: false } } }
  let lapsed = false
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    const usage = lapsed
      ? { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 250_000, model: 'claude-opus-5-5' }
      : { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 240_000, cache_creation_input_tokens: 10_000, model: 'claude-opus-5-5' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  } as never)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 250_000, cache_creation_input_tokens: 0 } } } as never
  })
  const turnOf = async (id: string) => {
    await $.turn.start({ text: 'go', turnId: id })
    await step($, id, 0, 'high')
    await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: id, reason: 'answer',
      usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  }
  await start($)
  await measure($, w, 40)
  await turnOf('t1')
  // Keep-warm stands aside for the compaction the sighting promises; none comes.
  await w.clock.advance(65 * 60_000)
  expect(forks).toBe(0)
  lapsed = true
  await turnOf('t2')
  expect(kept['idle-compacts:machine']).toBe(0)
  expect(w.toasts.filter(t => t === '◆ big conversations here are kept warm again · no idle compaction came').length).toBe(1)
  // From now on the account's big conversations are kept warm.
  lapsed = false
  await turnOf('t3')
  await w.clock.advance(55 * 60_000)
  expect(forks).toBe(1)
})

test('0.19.3: a cache that lapses within the hour leaves the sighting alone', { timeoutMs: 30_000 }, async ($, on) => {
  const kept: Record<string, unknown> = { 'idle-compacts:machine': (NOW - 3600) * 1000 }
  const w = world(on, {}, kept)
  w.config = { guard: { keep_warm: { compact: false } } }
  let lapsed = false
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    const usage = lapsed
      ? { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 250_000, model: 'claude-opus-5-5' }
      : { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 240_000, cache_creation_input_tokens: 10_000, model: 'claude-opus-5-5' }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage }
  } as never)
  const turnOf = async (id: string) => {
    await $.turn.start({ text: 'go', turnId: id })
    await step($, id, 0, 'high')
    await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: id, reason: 'answer',
      usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  }
  await start($)
  await measure($, w, 40)
  await turnOf('t1')
  await w.clock.advance(20 * 60_000)
  lapsed = true
  await turnOf('t2')
  await w.clock.advance(60_000)
  expect(typeof kept['idle-compacts:machine']).toBe('number')
  expect(kept['idle-compacts:machine']).not.toBe(0)
})

/** Whether line 2 says anything about the cache right now. */
async function cacheShown($: Engine) {
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  const found = await ui.find({ type: 'Text', text: /^cache / })
  await ui.unmount()
  return found !== undefined
}

const RESUMED = '/home/someone/.cache/g-line/resume/session-1.json'

/** What hooks.json's SessionStart command leaves for a resumed conversation: Claude Code's figures. */
function resumed(w: World, since: number, context: number, expired: boolean | null, at = NOW) {
  w.files[RESUMED] = JSON.stringify({ at, since, context, expired })
}

async function line2Has($: Engine, text: RegExp) {
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return found !== undefined
}

test('0.18.0: a resumed conversation shows its cache before its first request, from Claude Code\'s own figures', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  hintBelow(on)
  resumed(w, 600, 180_000, false)
  await start($)
  await measure($, w, 40)
  expect(await line2Has($, /^cache warm ~50m \(180k\)$/)).toBe(true)
  // Read once: the file is gone.
  expect(w.files[RESUMED]).toBeUndefined()
})

test('0.18.0: a conversation resumed after the cache lapsed reads cold, with what the next turn rebuilds', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  hintBelow(on)
  resumed(w, 5 * 3600, 150_000, true)
  await start($)
  await measure($, w, 40)
  expect(await line2Has($, /^cache cold, next turn rebuilds 150k$/)).toBe(true)
})

test('0.18.0: Claude Code\'s verdict sets the lifetime: expired after 10 minutes means a five-minute cache', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  hintBelow(on)
  resumed(w, 600, 90_000, true)
  await start($)
  await measure($, w, 40)
  expect(await line2Has($, /^cache cold/)).toBe(true)
})

test('0.18.0: figures the command leaves a little after the session starts are read on the beat', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  hintBelow(on)
  await start($)
  await measure($, w, 40)
  expect(await cacheShown($)).toBe(false)
  resumed(w, 120, 120_000, false)
  await w.clock.advance(16_000)
  expect(await line2Has($, /^cache warm ~5[78]m \(120k\)$/)).toBe(true)
})

test('0.18.0: a fresh start restores nothing, and neither does a file left from an earlier start', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  hintBelow(on)
  resumed(w, 60, 90_000, false, NOW - 3600)
  await start($)
  await measure($, w, 40)
  expect(await cacheShown($)).toBe(false)
})

test('0.18.0: keep-warm leaves a resumed conversation alone until its first request, then keeps it', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { keep_warm: true } }
  engineBelow(on)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 } } } as never
  })
  resumed(w, 60, 100_000, false)
  await start($)
  await measure($, w, 40)
  await w.clock.advance(55 * 60_000)
  // Claude Code would answer `nothing-to-fork`: no re-read tried, and keep-warm still on.
  expect(forks).toBe(0)
  expect(w.toasts.some(t => t.startsWith('Keep-warm stopped'))).toBe(false)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await w.clock.advance(50 * 60_000)
  expect(forks).toBe(1)
})

// ------------------------------------------------------------ 0.7.1

test('an account change counts the cache cold: line 2 says so, the next turn\'s receipt says it rebuilt after the change', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { account_command: ['acct'] }
  let who = 'first@example.com'
  w.run = argv => (argv[0] === 'acct' ? { value: { exitCode: 0, stdout: `${who}\n`, stderr: '' } } : undefined)
  let rebuild = false
  on('turn.step', async function* ($: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn',
      usage: rebuild
        ? { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 101_000, model: 'claude-opus-5-5' }
        : { input_tokens: 4, output_tokens: 300, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 10_000, model: 'claude-opus-5-5' } }
  } as never)
  hintBelow(on)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`✻ ${e.props.word}`}</Text>
  })
  const line2 = async () => {
    const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
    const found = await ui.find({ type: 'Text', text: /^cache / })
    await ui.unmount()
    return found?.text
  }
  await start($)
  await measure($, w, 30)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  expect(await line2()).toMatch(/^cache warm/)
  // The account manager switches accounts; the next reading (ten minutes on) sees it.
  who = 'second@example.com'
  await w.clock.advance(10 * 60_000)
  expect(await line2()).toBe('cache cold (account changed), next turn rebuilds 100k')
  expect(w.toasts.filter(t => t === '◆ account changed · the next turn starts a new cache').length).toBe(1)
  // The next turn writes the whole conversation again; its receipt says what it followed.
  rebuild = true
  await $.turn.start({ text: 'go', turnId: 't2' })
  const stream = $.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 2 } as never)
  for await (const _ of stream) { /* drain */ }
  await stream.result
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't2', reason: 'answer', usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await $.session.append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice', origin: { kind: 'engine' }, uuid: 'line-2' } as never)
  const line = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-2',
    props: { word: 'Baked', durationMs: 4000 }, viewport: { columns: 160, rows: 40 } })
  expect(await line.find({ type: 'Text', text: 'cache cold after account change · rebuilt 101k' })).toBeDefined()
  await line.unmount()
  // The new account's cache is warm again.
  expect(await line2()).toMatch(/^cache warm/)
})

test('/g-line guard simulate tries the rules with no quota spent, and a headless run is told the guard has no readings', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  engineBelow(on)
  hintBelow(on)
  const logs: string[] = []
  on('ui.log', ($, e) => {
    logs.push((e as unknown as { text: string }).text)
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  expect(await $.prompt.submit({ text: 'run it', wait: false, origin: { kind: 'sdk' } } as never)).toEqual({ text: 'run it' })
  expect(await $.prompt.submit({ text: 'again', wait: false, origin: { kind: 'sdk' } } as never)).toEqual({ text: 'again' })
  expect(logs).toEqual(['g-line guard: no usage readings in this session yet, so its rules cannot act on this prompt.'])
  await $.command.run({ command: 'g-line', args: 'guard simulate 5h 96' } as never)
  expect(w.toasts.some(t => t.startsWith('◆ guard · held: 4% of 5h left') && t.endsWith(' · simulated'))).toBe(true)
  expect((await $.prompt.submit(typed('try it'))).drop).toMatch(/^g-line held this: 4% of the 5-hour window left/)
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: /^guard: held, 4% 5h left till \d\d:\d\d \(sim\)$/ })).toBeDefined()
  await ui.unmount()
  // It ends by itself after 15 minutes.
  await w.clock.advance(16 * 60_000)
  expect(await $.prompt.submit(typed('after'))).toEqual({ text: 'after' })
  expect(w.toasts.some(t => t === '◆ guard · simulation over, real readings again')).toBe(true)
})

test('keep-warm keeps only the session typed in last on its account, and shows what its re-reads cost', { timeoutMs: 30_000 }, async ($, on) => {
  const kept: Record<string, unknown> = {}
  const w = world(on, {}, kept)
  w.config = { guard: { keep_warm: true } }
  engineBelow(on)
  hintBelow(on)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    w.usage.cost += 0.04
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 } } } as never
  })
  await start($)
  await measure($, w, 40)
  await $.prompt.submit(typed('go'))
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  expect(kept['touched:machine']).toEqual({ session: 'session-1', at: expect.any(Number) })
  // The person types in another session on the same account: this one isn't kept.
  kept['touched:machine'] = { session: 'session-2', at: 0 }
  await w.clock.advance(50 * 60_000)
  expect(forks).toBe(0)
  // Back here: the next idle stretch is kept, and line 2 and the pane say what it cost.
  await $.prompt.submit(typed('back'))
  await $.turn.start({ text: 'back', turnId: 't2' })
  await step($, 't2', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't2', reason: 'answer', usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await w.clock.advance(49 * 60_000)
  expect(forks).toBe(1)
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: 'kept warm 1× · $0.04' })).toBeDefined()
  await ui.unmount()
  await $.command.run({ command: 'g-line', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
    props: { bodyColumns: 140 } as never, viewport: { columns: 160, rows: 60 } })
  expect(await pane.find({ type: 'Text', text: /kept warm 1× \(\$0\.04\)/ })).toBeDefined()
  await pane.unmount()
})

test('keep-warm skips a session whose model changed since the last request', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { keep_warm: true } }
  engineBelow(on)
  let forks = 0
  on('model.fork', () => {
    forks += 1
    return { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 20, output_tokens: 3, cache_read_input_tokens: 100_000, cache_creation_input_tokens: 0 } } } as never
  })
  await start($)
  await measure($, w, 40)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  w.model = 'claude-sonnet-5-5'
  await w.clock.advance(50 * 60_000)
  expect(forks).toBe(0)
})

// ------------------------------------------------------------ 0.8.0

test('the roster: line 2 counts the other sessions on this machine and which wait on you; a permission ask here is written at once', { timeoutMs: 30_000 }, async ($, on) => {
  const kept: Record<string, unknown> = {}
  const w = world(on, {}, kept)
  hintBelow(on)
  // The first check asks the person; once they say yes, the call's own check
  // (Claude Code 2.1.308 runs one inside tool.call) allows it.
  let asked = false
  on('tool.check', () => (asked ? { decision: 'allow' } : ((asked = true), { decision: 'ask' })) as never)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }) as never)
  const line2 = async () => {
    const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
    const found = await ui.find({ type: 'Text', text: /other/ })
    await ui.unmount()
    return found?.text
  }
  await start($)
  await w.clock.advance(15_000)
  expect(kept['s:session-1']).toEqual(expect.objectContaining({ state: 'idle' }))
  expect(await line2()).toBeUndefined()
  kept['s:other-1'] = { at: w.clock.now(), state: 'waiting', since: w.clock.now() - 60_000, model: 'Opus 5.5' }
  kept['s:other-2'] = { at: w.clock.now(), state: 'working', since: w.clock.now() }
  kept['s:long-gone'] = { at: w.clock.now() - 10 * 60_000, state: 'idle', since: 0 }
  await w.clock.advance(15_000)
  expect(await line2()).toBe('2 others · 1 waiting')
  // An ask on the main loop: this session waits on the person, written before the next beat.
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.check({ tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'tu1' } as never)
  expect(kept['s:session-1']).toEqual(expect.objectContaining({ state: 'waiting' }))
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as never)
  expect(kept['s:session-1']).toEqual(expect.objectContaining({ state: 'working' }))
  // The pane lists them; the account shows only where an account_command is set.
  await $.command.run({ command: 'g-line', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
    props: { bodyColumns: 140 } as never, viewport: { columns: 160, rows: 80 } })
  expect(await pane.find({ type: 'Text', text: 'Sessions on this machine' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^waiting on you 1m · Opus 5\.5$/ })).toBeDefined()
  await pane.unmount()
  // Turned off, line 2 says nothing of them.
  await $.command.run({ command: 'g-line', args: 'set roster off' } as never)
  expect(await line2()).toBeUndefined()
  // The session's own entry goes when it ends.
  await $.command.run({ command: 'g-line', args: 'set roster on' } as never)
  await w.clock.advance(15_000)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'session-1' } as never)
  expect(kept['s:session-1']).toBeUndefined()
})

test('a turn stopped by the usage limit: told when it resets; with guard.resume one "continue" goes after the reset, shown and cancellable', { timeoutMs: 30_000 }, async ($, on) => {
  const kept: Record<string, unknown> = {}
  const w = world(on, {}, kept)
  w.config = { guard: { resume: true } }
  const seen = engineBelow(on)
  hintBelow(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }) as never)
  const stopped = async (id: string) => {
    w.usage.limits = [{ kind: 'five_hour', percentUsed: 100, resetsAt: ISO(Math.floor(w.clock.now() / 1000) + 3600) }]
    await $.turn.start({ text: 'go', turnId: id })
    await $.turn.complete({ answer: '', durationMs: 4000, isAborted: false, turnId: id, reason: 'error' } as never)
    await w.clock.advance(10)
  }
  await start($)
  await stopped('t1')
  expect(w.notes.some(n => /^Usage limit: g-line sends "continue" at \d\d:\d\d, after the 5-hour reset\. \/g-line guard cancel stops it\.$/.test(n.text))).toBe(true)
  expect(kept['lease:resume:machine']).toEqual({ holder: 'session-1', until: expect.any(Number) })
  const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
  expect(await ui.find({ type: 'Text', text: /^resumes \d\d:\d\d$/ })).toBeDefined()
  await ui.unmount()
  // Not before the reset; once after it, within the jitter.
  await w.clock.advance(55 * 60_000)
  expect(seen.prompts).toEqual([])
  await w.clock.advance(11 * 60_000)
  expect(seen.prompts).toEqual(['continue'])
  expect(kept['lease:resume:machine']).toBeUndefined()
  await w.clock.advance(60 * 60_000)
  expect(seen.prompts).toEqual(['continue'])
  // Cancelled, nothing goes.
  await stopped('t2')
  await $.command.run({ command: 'g-line', args: 'guard cancel' } as never)
  expect(w.toasts[w.toasts.length - 1]).toBe('g-line won\'t send anything after the reset.')
  await w.clock.advance(70 * 60_000)
  expect(seen.prompts).toEqual(['continue'])
  // Another session on the account holds the resume: this one only says so.
  kept['lease:resume:machine'] = { holder: 'session-9', until: w.clock.now() + 2 * 3600_000 }
  await stopped('t3')
  expect(w.toasts[w.toasts.length - 1]).toMatch(/another session here goes on after the reset/)
  await w.clock.advance(70 * 60_000)
  expect(seen.prompts).toEqual(['continue'])
})

test('without guard.resume a limit stop is only said, with the reset on your clock; the pane shows each window\'s reset', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  const seen = engineBelow(on)
  await start($)
  w.usage.limits = [{ kind: 'five_hour', percentUsed: 100, resetsAt: ISO(NOW + 2 * 3600) }, { kind: 'seven_day', percentUsed: 40, resetsAt: ISO(NOW + 3 * 86_400) }]
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.turn.complete({ answer: '', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'error' } as never)
  await w.clock.advance(10)
  expect(w.toasts.some(t => /^◆ the 5-hour limit stopped this turn · resets ~\d\d:\d\d$/.test(t))).toBe(true)
  await w.clock.advance(3 * 3600_000)
  expect(seen.prompts).toEqual([])
  w.usage.limits = [{ kind: 'five_hour', percentUsed: 30, resetsAt: ISO(Math.floor(w.clock.now() / 1000) + 2 * 3600) }]
  await $.session.measure({ context: { tokens: 1, window: 1_000_000, percent: 1 }, rateLimits: w.usage.limits, cost: { usd: 1 }, changed: ['rateLimits'] })
  await $.command.run({ command: 'g-line', args: '' } as never)
  const pane = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'Pane', requestId: 'g-line',
    props: { bodyColumns: 140 } as never, viewport: { columns: 160, rows: 80 } })
  expect(await pane.find({ type: 'Text', text: /^5-hour 30% used, resets \d\d:\d\d \(in (1h 59m|2h 0m)\)$/ })).toBeDefined()
  await pane.unmount()
})

// 0.8.1: what a live session showed.

test('a subagent\'s own turn leaves the main turn\'s record alone: the receipt keeps the guard\'s note', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  engineBelow(on)
  on('ui.render', { component: 'TurnDuration' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`✻ ${e.props.word} for 1m 4s`}</Text>
  })
  await start($)
  await measure($, w, 92)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'xhigh')
  await spawn($)
  // Every hook hears the subagent's run start and end, with its agentId.
  await $.turn.start({ text: 'look', turnId: 'a1-t', agentId: 'a1' } as never)
  await $.turn.complete({ answer: 'found it', durationMs: 2000, isAborted: false, turnId: 'a1-t', agentId: 'a1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-sonnet-5-5' } } as never)
  await $.turn.complete({ answer: 'done', durationMs: 64_000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await $.session.append({ message: { type: 'system', name: 'turn_duration', content: [] }, door: 'notice',
    origin: { kind: 'engine' }, uuid: 'line-1' } as never)
  const line = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'TurnDuration', requestId: 'line-1',
    props: { word: 'Baked', durationMs: 64_000 }, viewport: { columns: 160, rows: 40 } })
  expect(await line.find({ type: 'Text', text: 'guard: effort medium, 1 agent on a cheaper model' })).toBeDefined()
  await line.unmount()
})

test('a stop lets a background agent\'s report through, once per agent the main loop started; other wake-ups stay refused', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  const seen = engineBelow(on)
  await start($)
  await measure($, w, 96)
  await $.command.run({ command: 'g-line', args: 'guard once' } as never)
  expect(await $.prompt.submit(typed('start the agent'))).toEqual({ text: 'start the agent' })
  await $.turn.start({ text: 'start the agent', turnId: 't1' })
  await $.agent.spawn({ tool_use_id: 'tu', prompt: 'p', description: 'Look into it', subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: true, fork: false } as never)
  await $.turn.complete({ answer: 'started', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer',
    usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  // Its report arrives while the session is idle: it goes on to Claude, where a refusal would lose it.
  const report = { text: '<task-notification>done</task-notification>', wait: false, origin: { kind: 'task-notification' } } as never
  expect((await $.prompt.submit(report)).drop).toBeUndefined()
  // A second notice with no agent behind it, and a schedule waking up, are refused as before.
  expect((await $.prompt.submit(report)).drop).toBeDefined()
  expect((await $.prompt.submit({ text: 'check CI', wait: false, origin: { kind: 'scheduled-trigger' } } as never)).drop).toBeDefined()
  expect(seen.prompts).toEqual(['start the agent', '<task-notification>done</task-notification>'])
})

test('a refusal while simulating says it was simulated', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  engineBelow(on)
  await start($)
  await measure($, w, 10)
  await $.command.run({ command: 'g-line', args: 'guard simulate 5h 96' } as never)
  const refused = await $.prompt.submit(typed('go on'))
  expect(refused.drop).toMatch(/^g-line held this: 4% of the 5-hour window left \(simulated\), at or under your 5% stop\./)
  // Every toast fits the toast's three lines: its way out is never cut off.
  expect(w.toasts.filter(t => t.includes('simulat')).every(t => t.length <= 110)).toBe(true)
})

test('an account switched while idle, with the next turn on the new account, is not called cold', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { account_command: ['acct'] }
  let who = 'first@example.com (Max)'
  w.run = argv => (argv[0] === 'acct' ? { value: { exitCode: 0, stdout: `${who}\n`, stderr: '' } } : undefined)
  engineBelow(on)
  hintBelow(on)
  const line2 = async () => {
    const ui = await $.ui.mount({ plugin: 'g-line', surface: 'terminal', component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' }, viewport: { columns: 200, rows: 40 } })
    const found = await ui.find({ type: 'Text', text: /^cache / })
    await ui.unmount()
    return found?.text
  }
  await start($)
  await measure($, w, 30)
  await w.clock.advance(60_000)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await step($, 't1', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't1', reason: 'answer', usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  // Within two minutes of the turn the account is read again, confirming the account its cache was written under.
  await w.clock.advance(3 * 60_000)
  // The plan's note changes: still the same account.
  who = 'first@example.com (Max, 40% left)'
  await w.clock.advance(10 * 60_000)
  expect(await line2()).toMatch(/^cache warm/)
  // The account manager switches while idle; the next turn runs on the new account before g-line reads it.
  who = 'second@example.com (Max)'
  await $.turn.start({ text: 'go', turnId: 't2' })
  await step($, 't2', 0, 'high')
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 't2', reason: 'answer', usage: { ...USAGE_ARGS, model: 'claude-opus-5-5' } })
  await w.clock.advance(5 * 60_000)
  // The reading after that turn sees the new account; the cache that turn wrote is the new account's, warm.
  expect(await line2()).toMatch(/^cache warm/)
  expect(w.toasts.filter(t => t.startsWith('◆ account changed')).length).toBe(0)
})

test('a planned "continue" is dropped by /clear, by the session ending, and by a prompt you type first', { timeoutMs: 30_000 }, async ($, on) => {
  const kept: Record<string, unknown> = {}
  const w = world(on, {}, kept)
  w.config = { guard: { resume: true } }
  const seen = engineBelow(on)
  on('session.end', ($, e) => ({ sessionId: e.sessionId }) as never)
  const stopped = async (id: string) => {
    w.usage.limits = [{ kind: 'five_hour', percentUsed: 100, resetsAt: ISO(Math.floor(w.clock.now() / 1000) + 3600) }]
    await $.turn.start({ text: 'go', turnId: id })
    await $.turn.complete({ answer: '', durationMs: 4000, isAborted: false, turnId: id, reason: 'error' } as never)
    await w.clock.advance(10)
  }
  await start($)
  await stopped('t1')
  expect(kept['lease:resume:machine']).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 'session-1' } as never)
  expect(kept['lease:resume:machine']).toBeUndefined()
  await w.clock.advance(70 * 60_000)
  expect(seen.prompts).toEqual([])
  // You come back before the reset and type: your prompt goes, g-line's doesn't.
  await stopped('t2')
  w.usage.limits = []
  expect(await $.prompt.submit(typed('carry on with the tests'))).toEqual({ text: 'carry on with the tests' })
  expect(w.toasts[w.toasts.length - 1]).toBe('g-line won\'t send its prompt after the reset: you typed one.')
  await w.clock.advance(70 * 60_000)
  expect(seen.prompts).toEqual(['carry on with the tests'])
  // The guard paused when the time comes: nothing is sent, and it says why.
  await stopped('t3')
  await $.command.run({ command: 'g-line', args: 'guard pause 3h' } as never)
  await w.clock.advance(70 * 60_000)
  expect(seen.prompts).toEqual(['carry on with the tests'])
  expect(w.toasts.some(t => t === '◆ didn\'t send "continue" · the guard is paused')).toBe(true)
})

test('the agents rule leaves an agent type alone until it knows what that type runs on', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: GUARD }
  const seen = engineBelow(on)
  await start($)
  await measure($, w, 92)
  await $.turn.start({ text: 'go', turnId: 't1' })
  // A plugin's agent whose definition picks its own model (it may be Haiku): never moved, so never moved up.
  await spawn($, 'reviewer-plugin:quick-check')
  // Claude Code's general-purpose agent runs on its parent's model, Opus here: moved down to Sonnet.
  await spawn($, 'general-purpose')
  expect(seen.models).toEqual([undefined, 'sonnet'])
})

test('0.12.0: a paced week holds a prompt ahead of pace, says so in plain words, and /g-line guard why lists the figures', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { guard: { rules: [{ pace: { reserve: 10, burst: 8 } }] } }
  const seen = engineBelow(on)
  await start($)
  // Two days into the week, 60% used: 8 + 82 x 2/7 = 31% is allowed by now.
  const resetsAt = Math.floor(w.clock.now() / 1000) + 5 * 86_400
  w.usage.limits = [{ kind: 'seven_day', percentUsed: 60, resetsAt: ISO(resetsAt) }]
  await $.session.measure({ context: { tokens: 100_000, window: 1_000_000, percent: 10 }, rateLimits: w.usage.limits,
    cost: { usd: 1 }, changed: ['rateLimits'] })
  await w.clock.advance(15_000)
  expect(w.toasts.some(t => t === '◆ guard · over pace: 60% of the week used, 31% allowed · effort medium · agents on sonnet · new prompts held')).toBe(true)
  const refused = await $.prompt.submit(typed('go on'))
  expect(refused.drop).toMatch(/^g-line held this: ahead of pace: 60% of the week used, 31% allowed by now\./)
  await $.command.run({ command: 'g-line', args: 'guard why' } as never)
  expect(w.toasts.some(t => t.startsWith('g-line guard: Held: new prompts stop. The hold lifts about '))).toBe(true)
  // back on pace once the week has used little: the prompt goes through
  w.usage.limits = [{ kind: 'seven_day', percentUsed: 20, resetsAt: ISO(resetsAt) }]
  await $.session.measure({ context: { tokens: 100_000, window: 1_000_000, percent: 10 }, rateLimits: w.usage.limits,
    cost: { usd: 1 }, changed: ['rateLimits'] })
  expect(await $.prompt.submit(typed('go on now'))).toEqual({ text: 'go on now' })
  expect(seen.prompts).toEqual(['go on now'])
})

test('0.12.0: a pass for one prompt belongs to the account it was given for: after a switch it lapses', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on)
  w.config = { account_command: ['acct'], guard: { rules: [{ left: 10, stop: true }] } }
  let who = 'first@example.com'
  w.run = argv => (argv[0] === 'acct' ? { value: { exitCode: 0, stdout: `${who}\n`, stderr: '' } } : undefined)
  const seen = engineBelow(on)
  await start($)
  await measure($, w, 96)
  await w.clock.advance(15_000)
  await $.command.run({ command: 'g-line', args: 'guard once' } as never)
  who = 'second@example.com'
  await w.clock.advance(10 * 60_000)
  expect((await $.prompt.submit(typed('use the pass'))).drop).toBeDefined()
  expect(w.toasts.some(t => t.includes('your one-prompt pass lapsed: another account or window'))).toBe(true)
  // a held prompt sent again on the new account goes, but a pass given there is its own
  expect(await $.prompt.submit(typed('use the pass'))).toEqual({ text: 'use the pass' })
  expect(seen.prompts).toEqual(['use the pass'])
})

// ------------------------------------------------------------ 0.14.0

test('sessions on the same account share usage: an idle one reads what another just spent', { timeoutMs: 30_000 }, async ($, on) => {
  const store: Record<string, unknown> = {}
  const w = world(on, {}, store)
  w.config = { account_command: ['acct'], guard: { rules: [{ left: 12, stop: true }] } }
  w.run = argv => (argv[0] === 'acct' ? { value: { exitCode: 0, stdout: 'team@example.com\n', stderr: '' } } : undefined)
  engineBelow(on)
  hintBelow(on)
  await start($)
  await measure($, w, 84)
  await w.clock.advance(15_000)
  expect(await $.prompt.submit(typed('at 84'))).toEqual({ text: 'at 84' })
  const resets = Math.floor(w.clock.now() / 1000) + 2 * 3600
  // Another session on the same account, and one on another account, wrote theirs.
  store['g-line-limits:team@example.com'] = { at: w.clock.now(), limits: [{ kind: 'five_hour', percentUsed: 88, resetsAt: resets }] }
  store['g-line-limits:other@example.com'] = { at: w.clock.now(), limits: [{ kind: 'five_hour', percentUsed: 99, resetsAt: resets }] }
  await w.clock.advance(15_000)
  // The guard reads the shared 88%: 12% left, at its stop.
  expect((await $.prompt.submit(typed('at 88'))).drop).toMatch(/12% of the 5-hour window left/)
  // This session's own lower reading doesn't take it back.
  await measure($, w, 85)
  await w.clock.advance(15_000)
  expect((store['g-line-limits:team@example.com'] as { limits: { percentUsed: number }[] }).limits[0]?.percentUsed).toBe(88)
  expect((store['g-line-limits:other@example.com'] as { limits: { percentUsed: number }[] }).limits[0]?.percentUsed).toBe(99)
})

// ------------------------------------------------------------ 0.15.0

test('a usage_command reading from another machine reaches the guard; only a newer observation lowers it', { timeoutMs: 30_000 }, async ($, on) => {
  const store: Record<string, unknown> = {}
  const w = world(on, {}, store)
  const held = () => (store['g-line-limits:team@example.com'] as { limits: { percentUsed: number }[] }).limits[0]?.percentUsed
  w.config = { account_command: ['acct'], usage_command: ['usage'], guard: { rules: [{ left: 12, stop: true }] } }
  let printed = ''
  let calls = 0
  w.run = argv => {
    if (argv[0] === 'acct') return { value: { exitCode: 0, stdout: 'team@example.com\n', stderr: '' } }
    if (argv[0] === 'usage') {
      calls += 1
      return { value: { exitCode: 0, stdout: printed, stderr: '' } }
    }
    return undefined
  }
  engineBelow(on)
  hintBelow(on)
  await start($)
  await measure($, w, 50)
  const resetMs = w.clock.now() + 2 * 3600 * 1000
  const resets = new Date(resetMs).toISOString()
  printed = `{"five_hour":{"used_percentage":90,"resets_at":"${resets}"}}\n`
  await w.clock.advance(135_000)
  expect(calls).toBeGreaterThan(0)
  // Another machine spent it: 10% left, under the 12% stop.
  expect((await $.prompt.submit(typed('at 90'))).drop).toMatch(/10% of the 5-hour window left/)
  expect(held()).toBe(90)
  // A failure, junk, and a lower figure observed before the 90 change nothing.
  printed = 'oops'
  await w.clock.advance(135_000)
  expect(held()).toBe(90)
  const before = new Date(w.clock.now() - 3600 * 1000).toISOString()
  printed = `{"five_hour":{"used_percentage":20,"resets_at":"${resets}","observed_at":"${before}"}}\n`
  await w.clock.advance(135_000)
  expect(held()).toBe(90)
  // The engine's own figure with no response behind it yet doesn't take it back either.
  await measure($, w, 55, Math.round((resetMs - w.clock.now()) / 1000))
  await w.clock.advance(15_000)
  expect(held()).toBe(90)
  // A newer, lower observation does: the 90 was wrong, or the window was given back.
  printed = `{"five_hour":{"used_percentage":30,"resets_at":"${resets}"}}\n`
  await w.clock.advance(135_000)
  expect(held()).toBe(30)
})

test('a usage_command does nothing without an account_command', { timeoutMs: 30_000 }, async ($, on) => {
  const w = world(on, {}, {})
  w.config = { usage_command: ['usage'], guard: { rules: [{ left: 12, stop: true }] } }
  let calls = 0
  w.run = argv => {
    if (argv[0] === 'usage') calls += 1
    return undefined
  }
  engineBelow(on)
  hintBelow(on)
  await start($)
  await measure($, w, 50)
  await w.clock.advance(135_000)
  expect(calls).toBe(0)
  expect(await $.prompt.submit(typed('hi'))).toEqual({ text: 'hi' })
})
