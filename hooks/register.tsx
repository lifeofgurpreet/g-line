// glanceline, the mod: a live band above the prompt with your context, 5-hour
// and weekly limits (and where your pace lands them), prompt-cache warmth and
// git, plus a heads-up toast before the cache goes cold or a limit runs out.
//
// Everything shown is Claude Code's own figures (`$.session.usage()`, pushed
// by `session.measure`) or what the mod watched happen (each main-loop request
// and its cache tokens). Nothing is sent anywhere.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snap } from '../types'
import { SEP, alerts, fitExtra, layoutKeys, modelName, render, segments, str } from './core'
import type { Options, Payload, Preset, Tone } from './core'

const snap = atom({ plugin: 'glanceline', key: 'snap' } as const, {})
const tick = atom({ plugin: 'glanceline', key: 'tick' } as const, 0)
const seen = atom({ plugin: 'glanceline', key: 'seen' } as const, [])
const hidden = atom({ plugin: 'glanceline', key: 'hidden' } as const, false)

const PANE = 'glanceline'
const TICK_MS = 15_000

type Config = {
  preset: Preset
  segments?: string
  icons: 'none' | 'nerd'
  toasts: boolean
  cacheTtl: 'auto' | '5m' | '1h'
  accountCommand?: string[]
}

const DEFAULTS: Config = { preset: 'default', icons: 'none', toasts: true, cacheTtl: 'auto' }

const COLORS: Record<Tone, string | undefined> = {
  ok: 'success', warn: 'warning', bad: 'error', accent: 'claude', dim: undefined,
}

// ----------------------------------------------------------------- config

function merge(base: Config, raw: unknown): Config {
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const next = { ...base }
  if (r.preset === 'minimal' || r.preset === 'default' || r.preset === 'full') next.preset = r.preset
  if (typeof r.segments === 'string' && r.segments.trim()) next.segments = r.segments
  if (r.icons === 'none' || r.icons === 'nerd') next.icons = r.icons
  if (typeof r.toasts === 'boolean') next.toasts = r.toasts
  if (r.cache_ttl === '5m' || r.cache_ttl === '1h' || r.cache_ttl === 'auto') next.cacheTtl = r.cache_ttl
  const command = r.account_command
  if (Array.isArray(command) && command.length && command.every(word => typeof word === 'string')) {
    next.accountCommand = command as string[]
  }
  return next
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return JSON.parse(String(await $.fs.read(path)))
  } catch {
    return undefined
  }
}

/** Defaults, then the plugin's own config.json, the user's file, /config. */
async function loadConfig($: EngineInterface, options: Record<string, unknown>): Promise<Config> {
  let config = merge(DEFAULTS, await readJson($, `${$.plugin.root}/config.json`))
  const xdg = await $.env.get('XDG_CONFIG_HOME')
  const home = await $.env.get('HOME')
  const base = xdg || (home ? `${home}/.config` : undefined)
  if (base) config = merge(config, await readJson($, `${base}/glanceline/config.json`))
  const chosen: Record<string, unknown> = {}
  if (options.preset !== undefined && options.preset !== 'default') chosen.preset = options.preset
  if (options.icons !== undefined && options.icons !== 'none') chosen.icons = options.icons
  if (options.toasts === false) chosen.toasts = false
  return merge(config, chosen)
}

// ------------------------------------------------------------------ cache

function truthy(value: string | undefined): boolean {
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false'
}

/**
 * The TTL Claude Code writes for the main conversation, by its documented
 * rule: FORCE_PROMPT_CACHING_5M, CLAUDE_CODE_PROMPT_CACHE_TTL, the
 * promptCacheTtl setting, ENABLE_PROMPT_CACHING_1H; unset, one hour on a
 * subscription within its limits and five minutes otherwise. A hit or miss
 * the mod observed after an idle gap overrides the rule.
 */
async function explicitTtl($: EngineInterface, config: Config): Promise<'5m' | '1h' | undefined> {
  if (config.cacheTtl !== 'auto') return config.cacheTtl
  if (truthy(await $.env.get('FORCE_PROMPT_CACHING_5M'))) return '5m'
  const env = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')
  if (env === '5m' || env === '1h') return env
  try {
    const setting = (await $.settings.read()).promptCacheTtl
    if (setting === '5m' || setting === '1h') return setting
  } catch {
    // settings unreadable: fall through to the automatic rule
  }
  if (truthy(await $.env.get('ENABLE_PROMPT_CACHING_1H'))) return '1h'
  return undefined
}

function automaticTtl(s: Snap): '5m' | '1h' {
  const limits = s.rateLimits ?? []
  const subscription = limits.some(l => l.kind === 'five_hour' || l.kind === 'seven_day')
  const within = limits.every(l => l.percentUsed < 100)
  return subscription && within ? '1h' : '5m'
}

// ---------------------------------------------------------------- payload

/** The statusLine-shaped view of what the mod knows, for the core. */
export function payload(s: Snap, nowSeconds: number, ttl: '5m' | '1h' | undefined): Payload {
  const p: Payload = {}
  if (s.model) p.model = { display_name: modelName(s.model) }
  if (s.effort) p.effort = { level: s.effort }
  if (s.context && s.context.percent !== undefined) {
    p.context_window = { used_percentage: s.context.percent, context_window_size: s.context.window,
      total_input_tokens: s.context.tokens }
  }
  const limits: NonNullable<Payload['rate_limits']> = {}
  for (const limit of s.rateLimits ?? []) {
    if (limit.kind === 'five_hour' || limit.kind === 'seven_day' || limit.kind === 'spend_limit') {
      limits[limit.kind] = { used_percentage: limit.percentUsed, resets_at: limit.resetsAt }
    }
  }
  if (Object.keys(limits).length) p.rate_limits = limits
  if (s.costUsd !== undefined || s.startedAt !== undefined) {
    p.cost = { total_cost_usd: s.costUsd,
      total_duration_ms: s.startedAt !== undefined ? nowSeconds * 1000 - s.startedAt : undefined }
  }
  if (s.cache?.cached) {
    const effective = s.cache.learned ?? ttl ?? automaticTtl(s)
    const expires = s.cache.lastAt + (effective === '1h' ? 3600 : 300)
    p.prompt_cache = { caching_observed: true, ttl: effective, warm: expires > nowSeconds, expires_at: expires,
      recache_tokens_if_cold: s.cache.prefix }
  }
  if (s.git) p.git = s.git
  return p
}

// ------------------------------------------------------------------ mod

let config: Config = DEFAULTS
let ttl: '5m' | '1h' | undefined
let beats = 0

async function nowSeconds($: EngineInterface): Promise<number> {
  return (await $.clock.now()) / 1000
}

function limitsOf(list: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Snap['rateLimits'] {
  return list.map(l => ({ kind: l.kind, percentUsed: l.percentUsed,
    resetsAt: l.resetsAt ? Math.floor(Date.parse(l.resetsAt) / 1000) : undefined }))
}

async function measure($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  await update($, snap, s => ({
    ...s,
    startedAt: usage.startedAt,
    context: { tokens: usage.context.tokens, window: usage.context.window, percent: usage.context.percent },
    rateLimits: limitsOf(usage.rateLimits),
    costUsd: usage.cost?.usd,
  }))
}

async function refreshGit($: EngineInterface): Promise<void> {
  try {
    const run = await $.process.run(
      ['git', '--no-optional-locks', 'status', '--porcelain=v1', '--branch', '--untracked-files=no'],
      { timeoutMs: 2000 })
    if (run.exitCode !== 0) {
      await update($, snap, s => ({ ...s, git: null }))
      return
    }
    const [head = '', ...rest] = run.stdout.split('\n')
    const name = head.replace(/^## /, '').replace(/^No commits yet on /, '').split('...')[0]?.split(' ')[0]
    const branch = name === 'HEAD' ? 'detached' : str(name, 40)
    await update($, snap, s => ({ ...s, git: { branch, dirty: rest.some(line => line.trim()) } }))
  } catch {
    // no git, or too slow: keep the last reading
  }
}

async function refreshAccount($: EngineInterface): Promise<void> {
  const command = config.accountCommand
  if (!command) return
  try {
    const run = await $.process.run(command, { timeoutMs: 5000 })
    const line = run.exitCode === 0 ? str(run.stdout.split('\n')[0], 120) : undefined
    await update($, snap, s => ({ ...s, account: line ?? null }))
  } catch {
    await update($, snap, s => ({ ...s, account: null }))
  }
}

function optionsAt(seconds: number): Options {
  return { now: seconds, preset: config.preset, segments: config.segments, icons: config.icons,
    utcOffsetMinutes: -new Date(seconds * 1000).getTimezoneOffset() }
}

async function nudge($: EngineInterface): Promise<void> {
  if (!config.toasts) return
  const seconds = await nowSeconds($)
  const due = alerts(payload(await read($, snap), seconds, ttl), optionsAt(seconds))
  if (!due.length) return
  const already = await read($, seen)
  for (const alert of due) {
    if (!already.includes(alert.id)) $.ui.toast(alert.text, { timeoutMs: 12_000 })
  }
  await update($, seen, list => [...list, ...due.map(a => a.id).filter(id => !list.includes(id))].slice(-50))
}

async function heartbeat($: EngineInterface): Promise<void> {
  beats += 1
  await update($, tick, () => beats)
  await nudge($)
  if (beats % 2 === 0) await refreshGit($)
  if (beats % 40 === 0) await refreshAccount($)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    config = await loadConfig($, options as Record<string, unknown>)
    ttl = await explicitTtl($, config)
    // Tell a glanceline statusLine fallback in this session that the band is on.
    try {
      await $.env.set('GLANCELINE_MOD', await $.session.id())
    } catch {
      // older engines: the fallback simply keeps drawing
    }
    try {
      await $.command.register({
        name: 'glanceline',
        description: 'Open the glanceline details pane; `/glanceline off` hides the band, `on` shows it',
      })
    } catch {
      // the band and toasts work without the command
    }
    try {
      const id = await $.session.model()
      await update($, snap, s => ({ ...s, model: s.model ?? id }))
    } catch {
      // the first request names the model
    }
    await Promise.all([measure($).catch(() => undefined), refreshGit($), refreshAccount($)])
    $.clock.every(TICK_MS, () => void heartbeat($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, snap, s => ({
      ...s,
      context: { tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
      rateLimits: limitsOf(e.rateLimits),
      costUsd: e.cost?.usd ?? s.costUsd,
    }))
    void nudge($)
    return next(e)
  })

  // Each main-loop request: its model and effort, and whether the prompt
  // cache served it. Subagents keep caches of their own and are not counted.
  on('turn.step', async function* ($, e, next) {
    const started = await nowSeconds($)
    const result = yield* next(e)
    if (e.agentId === undefined && result.usage) {
      const u = result.usage
      const cached = u.cache_read_input_tokens + u.cache_creation_input_tokens > 0
      const prefix = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      await update($, snap, s => {
        let learned = s.cache?.learned
        const gap = s.cache ? started - s.cache.lastAt : 0
        if (s.cache?.cached && gap > 330 && gap < 3500) {
          // After 5+ idle minutes a read means the hour TTL; a full rewrite of
          // a large prefix means five minutes.
          if (u.cache_read_input_tokens > s.cache.prefix * 0.5) learned = '1h'
          else if (u.cache_creation_input_tokens > s.cache.prefix * 0.5) learned = '5m'
        }
        return { ...s, model: e.model, effort: typeof e.effort === 'string' ? e.effort : s.effort,
          cache: { lastAt: started, cached, prefix, learned } }
      })
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) void refreshGit($)
    return next(e)
  })

  on('command.run', { command: 'glanceline' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, hidden, () => arg === 'off')
      return { text: arg === 'off' ? 'glanceline band hidden. `/glanceline on` brings it back.' : 'glanceline band shown.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'glanceline' })
    return { text: opened.isPlaced ? 'glanceline details opened.' : 'glanceline: widen the terminal to see the details pane.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, hidden))) return next(e)
    await read($, tick)
    const seconds = await nowSeconds($)
    const s = await read($, snap)
    const room = Math.max(20, e.props.bodyColumns)
    const lines = render(payload(s, seconds, ttl), { ...optionsAt(seconds), columns: room })
    if (!lines.length && !s.account) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {lines.map((line, row) => (
          <Box key={`line-${row}`} flexDirection="row">
            {line.map((part, index) => (
              <Text key={part.key} wrap="truncate">
                {index > 0 ? <Text dimColor>{SEP}</Text> : null}
                <Text color={part.tone ? COLORS[part.tone] : undefined} dimColor={part.tone === 'dim'}
                  bold={part.tone === 'bad'}>{part.text}</Text>
              </Text>
            ))}
          </Box>
        ))}
        {s.account ? <Text dimColor wrap="truncate">{fitExtra([s.account], room)}</Text> : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, tick)
    const seconds = await nowSeconds($)
    const s = await read($, snap)
    const p = payload(s, seconds, ttl)
    const opts = { ...optionsAt(seconds), preset: 'full' as const, segments: undefined }
    const rows = segments(p, opts).flat()
    const heads = alerts(p, opts)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {rows.map(row => (
          <Text key={row.key} color={row.tone ? COLORS[row.tone] : undefined} dimColor={row.tone === 'dim'}>
            {row.forms[0]}
          </Text>
        ))}
        {s.account ? <Text dimColor>{s.account}</Text> : null}
        {heads.map(alert => <Text key={alert.id} color="warning">{alert.text}</Text>)}
        <Text dimColor>
          {`Pace projects your average rate since each window opened. Layout: ${layoutKeys(optionsAt(seconds)).map(l => l.join(',')).join(' | ')}.`}
        </Text>
      </Box>
    )
  })
}
