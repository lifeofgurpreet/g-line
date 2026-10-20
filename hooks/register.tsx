// g-line, the mod: live status under the prompt, receipts on the turns.
//
// The live figures ride on lines Claude Code already draws: the hint line
// under the prompt (context, 5-hour and weekly limits with pace, cache, git),
// the footer's mode labels (agents at work, when the context will compact),
// the working spinner (what the turn has cost so far) and the line that
// closes each turn (`Baked for 1m 4s · $0.38 · 94% cached · 7 tools`).
// Heads-ups arrive as toasts and native notifications; everything else is in
// the `/g-line` pane and its share card.
//
// Every figure is Claude Code's own (`$.session.usage()`, `session.measure`,
// `turn.complete`, `$.agent.list()`, `session.compact`, `tool.call`) or what
// the mod watched happen. No transcript is parsed, nothing is estimated that
// the engine reports, and nothing leaves the machine.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Receipt, Snap, Totals } from '../types'
import { SEP, alerts, layoutKeys, modelName, pct, segments, str, tokens, width } from './core'
import type { Options, Payload, Preset, Segment, Tone } from './core'
import {
  EMPTY_TOTALS, RECEIPT_PRESETS, agentsSegment, cacheHit, cardLines, coach, compactionText, contextView, costRatio,
  dayOf, fitParts, forecast, forecastSegment, isActive, isEnded, ledger, loopWarning, money, receiptSpec,
  receiptText, spark, spinnerParts, staleKeys, target, todaySegment, turnLength, turnLineWidth, unusedServers,
} from './extras'
import type { ReceiptSpec } from './extras'
import { MOD_KEYS, accountSegment, inline, joined, modesWidth, shownHint, tailRoom, withText } from './inline'
import { deck, nextRoom } from './deck'
import { STATUS_DESCRIPTION, STATUS_SCHEMA, STATUS_TOOL, statusJson } from './glance'
import { PULSE_BEATS, PULSE_EVERY_MS, PULSE_TTL_MS, PULSE_URL, ageOf, clean, countOf, muted, pageOf, parseFeed, pulseRow, safeUrl, tickerText, xLead } from './pulse'
import type { PulseFeed, PulseItem } from './pulse'
import { gitSegmentOf } from './core'
import {
  DEFAULTS, GROUPS, SETTINGS, changed, merge, nextValue, originOf, parseCommand, patchOf, said, withPatch, withoutSetting,
} from './settings'
import type { Config, Layer, Setting } from './settings'

const snap = atom({ plugin: 'g-line', key: 'snap' } as const, {})
const tick = atom({ plugin: 'g-line', key: 'tick' } as const, 0)
const seen = atom({ plugin: 'g-line', key: 'seen' } as const, [])
const hidden = atom({ plugin: 'g-line', key: 'hidden' } as const, false)
const receipts = atom({ plugin: 'g-line', key: 'receipts' } as const, {})
const turnNow = atom({ plugin: 'g-line', key: 'turn' } as const, null)
const agents = atom({ plugin: 'g-line', key: 'agents' } as const, [])
const totals = atom({ plugin: 'g-line', key: 'totals' } as const, EMPTY_TOTALS)
const outlook = atom({ plugin: 'g-line', key: 'forecast' } as const, null)
const contextAtom = atom({ plugin: 'g-line', key: 'context' } as const, null)
const ledgerAtom = atom({ plugin: 'g-line', key: 'ledger' } as const, null)
const view = atom({ plugin: 'g-line', key: 'view' } as const, 'details')
const pulseAtom = atom({ plugin: 'g-line', key: 'pulse' } as const, null)
const turnover = atom({ plugin: 'g-line', key: 'turnover' } as const, 0)
const newsAt = atom({ plugin: 'g-line', key: 'newsAt' } as const, 0)

const PANE = 'g-line'
const INSTALL = '/plugin install g-line --marketplace lifeofgurpreet/g-line'
/** The command's name, and the 0.4 name it still answers to for one release. */
const COMMAND = 'g-line'
const OLD_COMMAND = 'glanceline'
const TICK_MS = 15_000
/**
 * A status line command steps aside while this session's file is under a
 * minute old. The path keeps the 0.4 name: other tools read it.
 */
const LIVE_DIR = '.cache/glanceline/live'
const STATE_DIR = '.cache/g-line/state'

const COLORS: Record<Tone, string | undefined> = {
  ok: 'success', warn: 'warning', bad: 'error', accent: 'claude', dim: undefined,
}

// ----------------------------------------------------------------- config

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return JSON.parse(String(await $.fs.read(path)))
  } catch {
    return undefined
  }
}

/** The files config is read from, lowest first, each with the name `/g-line settings` gives it. */
async function configFiles($: EngineInterface): Promise<{ name: string; path: string }[]> {
  const files = [{ name: 'plugin', path: `${$.plugin.root}/config.json` }]
  const xdg = await $.env.get('XDG_CONFIG_HOME')
  const home = await $.env.get('HOME')
  const base = xdg || (home ? `${home}/.config` : undefined)
  // The 0.4 name's file, then the new one: settings carry over across the rename.
  if (base) {
    files.push({ name: 'glanceline/config.json', path: `${base}/glanceline/config.json` })
    files.push({ name: 'config.json', path: `${base}/g-line/config.json` })
  }
  return files
}

/** What /config sets; its rows left at their defaults say nothing. */
function chosenOf(options: Record<string, unknown>): Record<string, unknown> {
  const chosen: Record<string, unknown> = {}
  if (options.lines !== undefined && options.lines !== '2') chosen.lines = options.lines
  if (options.preset !== undefined && options.preset !== 'default') chosen.preset = options.preset
  if (options.icons !== undefined && options.icons !== 'none') chosen.icons = options.icons
  if (options.toasts === false) chosen.toasts = false
  if (options.notifications === false) chosen.notify = false
  if (options.receipt !== undefined && options.receipt !== 'adaptive') chosen.receipt = options.receipt
  return chosen
}

/** The layer of choices made with /g-line, in the pane or by command. */
const CHOSEN = 'your choice'

/** Defaults, then the plugin's own config.json, the user's files, /config, then choices made with /g-line: the most recent. */
async function loadConfig($: EngineInterface, options: Record<string, unknown>): Promise<{ config: Config; layers: Layer[] }> {
  const found: Layer[] = []
  for (const file of await configFiles($)) found.push({ name: file.name, raw: await readJson($, file.path) })
  found.push({ name: '/config', raw: chosenOf(options) })
  try {
    found.push({ name: CHOSEN, raw: (await $.store.get(SETTINGS_KEY)) ?? {} })
  } catch {
    // no store: the files and /config decide
  }
  return { config: found.reduce((c, layer) => merge(c, layer.raw), DEFAULTS), layers: found }
}

const SETTINGS_KEY = 'settings'

/**
 * What changes when config is read again: the files' times and the saved
 * choices (another session's pane writes them). Checked on the beat, so an
 * edit to ~/.config/g-line/config.json reaches running sessions within 30 s.
 */
async function configStamp($: EngineInterface): Promise<string> {
  const parts: string[] = []
  for (const file of await configFiles($)) {
    try {
      parts.push(String((await $.fs.stat(file.path)).mtimeMs))
    } catch {
      parts.push('-')
    }
  }
  try {
    parts.push(JSON.stringify((await $.store.get(SETTINGS_KEY)) ?? null))
  } catch {
    parts.push('-')
  }
  return parts.join('|')
}

/** Reads every layer again and applies what changed. */
async function reloadConfig($: EngineInterface): Promise<void> {
  const before = config
  ;({ config, layers } = await loadConfig($, startOptions))
  stamp = await configStamp($)
  await applied($, before)
}

/** Makes a change of settings take effect in this session, without a restart. */
async function applied($: EngineInterface, before: Config): Promise<void> {
  if (config.cacheTtl !== before.cacheTtl) ttl = await explicitTtl($, config)
  if (config.exportState !== before.exportState) await setupLive($)
  if (config.claudeReads && !statusRegistered) await registerStatus($)
  if (config.pulse && !before.pulse) await refreshPulse($, true)
  await update($, tick, n => n + 1)
}

/** Saves the choice for later sessions and applies it now. */
async function choose($: EngineInterface, patch: Record<string, unknown>): Promise<void> {
  const held = layers.find(layer => layer.name === CHOSEN)?.raw
  let saved = (held && typeof held === 'object' ? held : {}) as Record<string, unknown>
  try {
    saved = ((await $.store.get(SETTINGS_KEY)) ?? {}) as Record<string, unknown>
  } catch {
    // the choice holds for this session
  }
  await keep($, withPatch(saved, patch))
}

/** Replaces the saved choices: they now decide, over the files and /config. */
async function keep($: EngineInterface, saved: Record<string, unknown>): Promise<void> {
  try {
    await $.store.set(SETTINGS_KEY, saved)
  } catch {
    // the choice holds for this session
  }
  const before = config
  layers = [...layers.filter(layer => layer.name !== CHOSEN), { name: CHOSEN, raw: saved }]
  config = layers.reduce((c, layer) => merge(c, layer.raw), DEFAULTS)
  stamp = await configStamp($)
  await applied($, before)
}

/** The toast after a setting changes: its new value, and when it takes effect if not at once. */
function changedText(setting: Setting): string {
  const value = said(setting, config)
  const note = setting.key === 'claude_reads'
    ? (config.claudeReads ? ' Claude can call g-line\'s status tool from your next message.' : ' The status tool now answers that it is off, and is gone in new sessions.')
    : setting.key === 'pulse' && config.pulse ? ' Headlines from g-line\'s feed on long turns and in /g-line; one static file, fetched every 45 minutes.'
      : setting.key === 'pulse' ? ' No fetches.' : ''
  return `${setting.label}: ${value}.${note}`
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

/**
 * Claude Code's idle compaction: on unless `"idleCompaction": false`, for an
 * hour-long cache holding at least `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`
 * (200k unset). It summarises the conversation shortly before the cache expires.
 */
type IdleCompaction = { minTokens: number }

async function idleCompactionOf($: EngineInterface): Promise<IdleCompaction | undefined> {
  try {
    if ((await $.settings.read()).idleCompaction === false) return undefined
  } catch {
    // settings unreadable: Claude Code's default, on
  }
  const min = Number(await $.env.get('CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS'))
  return { minTokens: Number.isFinite(min) && min > 0 ? Math.max(100_000, min) : 200_000 }
}

function automaticTtl(s: Snap): '5m' | '1h' {
  const limits = s.rateLimits ?? []
  const subscription = limits.some(l => l.kind === 'five_hour' || l.kind === 'seven_day')
  const within = limits.every(l => l.percentUsed < 100)
  return subscription && within ? '1h' : '5m'
}

// ---------------------------------------------------------------- payload

/** The statusLine-shaped view of what the mod knows, for the core. */
export function payload(s: Snap, nowSeconds: number, ttl: '5m' | '1h' | undefined, idle?: IdleCompaction): Payload {
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
    const compacted = s.cache.compactedTo !== undefined
    p.prompt_cache = { caching_observed: true, ttl: effective, warm: !compacted && expires > nowSeconds, expires_at: expires,
      recache_tokens_if_cold: compacted ? s.cache.compactedTo || undefined : s.cache.prefix }
    if (compacted) p.prompt_cache.compacted = true
    else if (idle && effective === '1h' && s.cache.prefix >= idle.minTokens) p.prompt_cache.idle_compacts = true
  }
  if (s.git) p.git = s.git
  return p
}

// ------------------------------------------------------------------ mod

let config: Config = DEFAULTS
/** Where config came from, lowest first: `/g-line settings` names the layer each value is from. */
let layers: Layer[] = []
/** The config files' times and the saved choices when last read. */
let stamp = ''
let startOptions: Record<string, unknown> = {}
let statusRegistered = false
let ttl: '5m' | '1h' | undefined
let idle: IdleCompaction | undefined
let beats = 0
let liveFile: string | undefined
let stateFile: string | undefined
let sessionId: string | undefined
/** The receipt of the main-loop turn that just ended, until its closing line is appended. */
let pending: Promise<Receipt> | undefined
/** The hint line's last text: `1 shell` and the like say background work is running. */
let lastHint = ''
/** Whether this turn's first request rebuilt a cold cache. */
let coldThisTurn = false
/** Whether the last account reading failed or ran out of time. */
let accountMissed = false
/** The messages the next request is built from, counted once the last request's session went idle. */
let idleCount: { lastAt: number; messages: number } | undefined
/** Pulse's 8-second beats so far; the row moves on every `PULSE_BEATS[speed]` of them. */
let pulseBeats = 0
/** Consecutive failures per agent, tool and target. */
const streaks = new Map<string, number>()

const UNREADABLE = JSON.stringify({ schema: 1, state: 'unavailable' })
const STATUS_OFF = JSON.stringify({ schema: 1, state: 'disabled', note: 'The person turned this tool off (/g-line set claude_reads on turns it back on).' })
const BACKGROUND = /\b\d+ (?:shells?|monitors?|tasks?|agents?|workflows?|background)\b/i
/** Columns a receipt leaves for Claude Code's own words on a closing line that reports background work. */
const BACKGROUND_ROOM = 64
/** The settings the details view offers at once; the rest are a key away. */
const QUICK = SETTINGS.filter(setting => ['lines', 'receipt', 'pulse'].includes(setting.key))

async function nowMs($: EngineInterface): Promise<number> {
  return $.clock.now()
}

async function nowSeconds($: EngineInterface): Promise<number> {
  return (await $.clock.now()) / 1000
}

const offsetAt = (ms: number) => -new Date(ms).getTimezoneOffset()

function limitsOf(list: readonly { kind: string; percentUsed: number; resetsAt?: string }[]): Snap['rateLimits'] {
  return list.map(l => ({ kind: l.kind, percentUsed: l.percentUsed,
    resetsAt: l.resetsAt ? Math.floor(Date.parse(l.resetsAt) / 1000) : undefined }))
}

/** The highest percent each window has reached, so a reset can say what it freed. */
function peaksOf(s: Snap, limits: Snap['rateLimits']): Snap['peaks'] {
  const peaks = { ...(s.peaks ?? {}) }
  for (const l of limits ?? []) {
    if ((l.kind === 'five_hour' || l.kind === 'seven_day') && l.resetsAt) {
      const key = `${l.kind}:${l.resetsAt}`
      peaks[key] = Math.max(peaks[key] ?? 0, l.percentUsed)
    }
  }
  return peaks
}

/**
 * The cache once the engine's context count falls below half the last
 * request's prefix with no request since: a compaction replaced the
 * conversation, whether or not a `session.compact` reached the mod.
 */
function shrunk(cache: Snap['cache'], context: number | undefined): Snap['cache'] {
  if (!cache || context === undefined || context <= 0 || cache.compactedTo) return cache
  return context < cache.prefix / 2 ? { ...cache, compactedTo: context } : cache
}

/** Marks the cached conversation replaced by a compaction, `after` tokens when known. */
async function markCompacted($: EngineInterface, after?: number): Promise<void> {
  await update($, snap, s => (s.cache
    ? { ...s, cache: { ...s.cache, compactedTo: after ?? s.cache.compactedTo ?? 0 } }
    : s))
}

/**
 * Idle compaction reports itself through `session.compact` and the
 * `compaction` door, and a managed plugin seated ahead of this one can send
 * both on past it; Claude Code's context count then waits for the next
 * request. What stays readable is the conversation the next request is built
 * from: counted once the session is idle, it falls below half when a
 * compaction replaces it with a summary.
 */
async function watchIdle($: EngineInterface): Promise<void> {
  const cache = (await read($, snap))?.cache
  if (!cache?.cached || cache.compactedTo !== undefined) return
  if ((await nowSeconds($)) - cache.lastAt < 60) return
  const messages = (await $.session.messages({ as: 'api' })).length
  if (idleCount?.lastAt !== cache.lastAt) idleCount = { lastAt: cache.lastAt, messages }
  else if (messages < idleCount.messages / 2) await markCompacted($)
}

async function measure($: EngineInterface): Promise<void> {
  const usage = await $.session.usage()
  const limits = limitsOf(usage.rateLimits)
  await update($, snap, s => ({
    ...s,
    startedAt: usage.startedAt,
    context: { tokens: usage.context.tokens, window: usage.context.window, percent: usage.context.percent },
    rateLimits: limits,
    costUsd: usage.cost?.usd,
    peaks: peaksOf(s, limits),
    cache: shrunk(s.cache, usage.context.tokens),
  }))
}

async function refreshGit($: EngineInterface, force = false): Promise<void> {
  if (!force && !layoutHas('git')) return
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

/**
 * The account line, read again every ten minutes. A command that answers says
 * what is now known, an empty line included; one that fails or runs past its
 * time on a loaded box says nothing, so the last reading stays and the next
 * try comes a minute later.
 */
async function refreshAccount($: EngineInterface): Promise<void> {
  const command = config.accountCommand
  if (!command) return
  try {
    const run = await $.process.run(command, { timeoutMs: 5000 })
    accountMissed = run.exitCode !== 0
    if (accountMissed) return
    const line = str(run.stdout.split('\n')[0], 120)
    await update($, snap, s => ({ ...s, account: line ?? null }))
  } catch {
    accountMissed = true
  }
}

function optionsAt(seconds: number): Options {
  return { now: seconds, preset: config.preset, segments: config.segments, icons: config.icons,
    utcOffsetMinutes: offsetAt(seconds * 1000) }
}

/** A heads-up that reaches you in another app, or a toast when no channel takes it. */
async function heads($: EngineInterface, text: string, title: string, notify: boolean): Promise<void> {
  if (await read($, hidden)) return
  if (notify) {
    try {
      if ((await $.ui.notify(text, { title })).isSent) return
    } catch {
      // a hook refused it, or the write failed: fall back to the toast
    }
  }
  await toast($, text, 12_000)
}

/** A terminal toast, unless toasts are off or `/g-line off` hid the mod. */
async function toast($: EngineInterface, text: string, timeoutMs: number): Promise<void> {
  if (config.toasts && !(await read($, hidden))) $.ui.toast(text, { timeoutMs })
}

/** Puts a command in the prompt box for Tab to take, unless the mod is hidden. */
async function suggest($: EngineInterface, text: string): Promise<void> {
  if (!(await read($, hidden))) await $.prompt.suggest({ text }).catch(() => undefined)
}

/** Marks an id as handled; true the first time. */
async function once($: EngineInterface, id: string): Promise<boolean> {
  if ((await read($, seen)).includes(id)) return false
  await update($, seen, list => (list.includes(id) ? list : [...list, id].slice(-100)))
  return true
}

/** True the first time any session asks about `key`; the store keeps it across sessions. */
async function firstAcrossSessions($: EngineInterface, key: string): Promise<boolean> {
  try {
    if ((await $.store.get(key)) !== undefined) return false
    await $.store.set(key, Math.floor(await nowSeconds($)))
    return true
  } catch {
    return true
  }
}

async function nudge($: EngineInterface): Promise<void> {
  const seconds = await nowSeconds($)
  const s = await read($, snap)
  const p = payload(s, seconds, ttl, idle)
  for (const alert of alerts(p, optionsAt(seconds))) {
    if (!(await once($, alert.id))) continue
    if (alert.id.startsWith('cache:')) {
      await heads($, alert.text, 'Prompt cache', config.notify.cache)
      continue
    }
    // The coach speaks once per 5-hour window across every session, so a new
    // session in a hot window doesn't offer the same command again.
    const advice = config.coach && alert.id.startsWith('five_hour:') && (await firstAcrossSessions($, `coach:${alert.id}`))
      ? coach('five_hour', p.rate_limits?.five_hour, seconds, s.effort, offsetAt(seconds * 1000)) : undefined
    await toast($, advice ? advice.text : alert.text, 15_000)
    if (advice) await suggest($, advice.suggest)
  }
  // A window that reset while you were near or at its limit.
  for (const [key, peak] of Object.entries(s.peaks ?? {})) {
    const [kind, at] = key.split(':')
    const resetAt = Number(at)
    if (!Number.isFinite(resetAt) || resetAt > seconds || seconds - resetAt > 6 * 3600) continue
    if (peak < config.resetThreshold || !(await once($, `reset:${key}`))) continue
    const name = kind === 'five_hour' ? '5-hour' : 'weekly'
    await heads($, `Your ${name} usage window has reset. You'd reached ${pct(peak)} of it.`, 'Usage window reset', config.notify.reset)
  }
}

/**
 * Tells any status line command configured in this session (an older
 * glanceline, a team's own) that the mod draws these figures, so they never
 * show twice: such a command reads the file named after its session id and
 * steps aside while it is under a minute old. Nothing else is in it.
 */
async function markLive($: EngineInterface): Promise<void> {
  if (!liveFile) return
  try {
    await $.fs.write(liveFile, `${Math.floor(await nowSeconds($))}\n`)
  } catch {
    // unwritable home: such a command keeps drawing, which is only redundant
  }
}

async function setupLive($: EngineInterface): Promise<void> {
  try {
    const home = await $.env.get('HOME')
    const id = await $.session.id()
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return
    sessionId = id
    if (!home) return
    liveFile = `${home}/${LIVE_DIR}/${id}`
    stateFile = config.exportState ? `${home}/${STATE_DIR}/${id}.json` : undefined
    await markLive($)
    // Forget sessions that ended more than a day ago.
    await $.process.run(['find', `${home}/${LIVE_DIR}`, '-type', 'f', '-mmin', '+1440', '-delete'], { timeoutMs: 2000 })
    if (stateFile) await $.process.run(['find', `${home}/${STATE_DIR}`, '-type', 'f', '-mmin', '+1440', '-delete'], { timeoutMs: 2000 })
  } catch {
    // best effort
  }
}

/** The figures as JSON for tmux, sketchybar and other bars, when `export_state` is on. */
async function exportState($: EngineInterface): Promise<void> {
  if (!stateFile) return
  try {
    const seconds = await nowSeconds($)
    const s = await read($, snap)
    const p = payload(s, seconds, ttl, idle)
    const active = (await read($, agents)).filter(row => isActive(row.status)).length
    const body = {
      updatedAt: Math.floor(seconds), line: joined(inline(p, optionsAt(seconds))),
      model: p.model?.display_name, context: p.context_window?.used_percentage,
      fiveHour: p.rate_limits?.five_hour?.used_percentage, sevenDay: p.rate_limits?.seven_day?.used_percentage,
      cache: p.prompt_cache ? { warm: p.prompt_cache.warm, expiresAt: p.prompt_cache.expires_at } : undefined,
      agents: active, cost: s.costUsd,
    }
    await $.fs.write(stateFile, `${JSON.stringify(body)}\n`)
  } catch {
    // best effort
  }
}

// ----------------------------------------------------------------- agents

/** Reads the engine's agent list and says when a background agent ends. */
async function refreshAgents($: EngineInterface): Promise<void> {
  let list
  try {
    list = await $.agent.list()
  } catch {
    return
  }
  const at = await nowMs($)
  const before = await read($, agents)
  const ended: AgentRow[] = []
  const rows = before.map(row => {
    const live = list.find(one => one.id === row.id)
    const status = live?.status ?? (isActive(row.status) ? 'ended' : row.status)
    const next = { ...row, status, endedAt: row.endedAt ?? (isEnded(status) ? at : undefined) }
    if (isActive(row.status) && isEnded(status)) ended.push(next)
    return next
  })
  for (const one of list) {
    if (rows.some(row => row.id === one.id)) continue
    rows.push({ id: one.id, description: one.description, type: one.type, status: one.status,
      background: true, teammate: one.teammateId !== undefined, startedAt: at,
      endedAt: isEnded(one.status) ? at : undefined })
  }
  await update($, agents, () => rows.slice(-50))
  for (const row of ended) {
    if (!row.background) continue
    const what = `"${row.description.slice(0, 60)}"`
    if (row.status === 'failed' || row.status === 'killed') {
      await heads($, `Background agent ${what} ${row.status === 'failed' ? 'failed' : 'was stopped'}.`, 'Agent', config.notify.agents)
    } else if (config.notify.agents) {
      await heads($, `Background agent ${what} finished.`, 'Agent', true)
    }
  }
}

// ----------------------------------------------------------------- turns

/** The receipt of a main-loop turn, from the engine's ledger and the turn's usage. */
async function receiptOf($: EngineInterface, e: { durationMs: number; usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number } }): Promise<Receipt> {
  const live = await read($, turnNow)
  let cost: number | undefined
  let context: number | undefined
  try {
    const usage = await $.session.usage()
    if (usage.cost && live?.costAt !== undefined) cost = Math.max(0, usage.cost.usd - live.costAt)
    if (usage.context.tokens !== undefined && live?.contextAt !== undefined) context = usage.context.tokens - live.contextAt
  } catch {
    // no ledger: the receipt shows what the turn's usage says
  }
  const rows = await read($, agents)
  const active = rows.some(row => isActive(row.status))
  const overlap = (live?.overlap ?? false) || rows.some(row => row.background && isActive(row.status))
  const earlier = Object.values(await read($, receipts)).sort((x, y) => x.endAt - y.endAt).slice(-20)
    .filter(one => one.cost !== undefined && one.cost > 0 && !one.overlap).map(one => one.cost as number)
  let window: number | undefined
  try {
    window = (await read($, snap)).context?.window
  } catch {
    window = undefined
  }
  return {
    cost, context, cacheHit: e.usage ? cacheHit(e.usage) : undefined,
    tools: live?.tools ?? 0, agents: live?.agents ?? 0, output: e.usage?.output_tokens,
    endAt: await nowMs($), durationMs: e.durationMs, background: active || BACKGROUND.test(lastHint),
    cacheWrite: live?.cacheWrite, warmBefore: live?.warmBefore, failures: live?.failures,
    failedTool: live?.failedTool ?? undefined, overlap, cold: live?.cold, compacted: live?.compacted, window,
    ratio: costRatio(cost, overlap, earlier),
  }
}

/** After a main-loop turn: totals, the forecast, the context view and the day's ledger. */
async function afterTurn($: EngineInterface, r: Receipt, aborted: boolean): Promise<void> {
  let context: number | undefined
  let percent: number | undefined
  let breakdown
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    context = usage.context.tokens
    percent = usage.context.percent
    breakdown = usage.context.breakdown
    await update($, snap, s => ({ ...s, context: { tokens: usage.context.tokens, window: usage.context.window,
      percent: usage.context.percent }, costUsd: usage.cost?.usd ?? s.costUsd }))
  } catch {
    // keep the last figures
  }
  const cold = r.cold === true
  const t = await update($, totals, x => ({
    ...x, turns: x.turns + 1, colds: x.colds + (cold ? 1 : 0),
    peakContext: Math.max(x.peakContext, percent ?? 0),
    growth: r.context !== undefined && r.context >= 0 ? [...x.growth, r.context].slice(-8) : x.growth,
  }))
  const at = await nowMs($)
  if (breakdown) await update($, contextAtom, () => contextView(breakdown, at))
  const f = forecast(context, breakdown?.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined, t.growth) ?? null
  await update($, outlook, () => f)
  if (f && f.turns <= 2 && (await once($, `compact:${t.compactions.length}`))) {
    await toast($, `Context compacts ${f.turns <= 1 ? 'soon' : `in ~${f.turns} turns`}. To choose what's kept, run /compact with a note now${config.coach ? ' (Tab starts one)' : ''}.`, 15_000)
    if (config.coach) await suggest($, '/compact keep ')
  }
  if (!aborted && r.durationMs >= config.longTurnSeconds * 1000 && config.notify.longTurn) {
    const cost = r.cost !== undefined && r.cost > 0 ? ` · ${money(r.cost)}` : ''
    await heads($, `Turn finished after ${turnLength(r.durationMs)}${cost}.`, 'Claude Code', true)
  }
  await addToDay($, r, cold, at)
}

/** Adds the turn to this session's entry for the day, then sums every session's. */
async function addToDay($: EngineInterface, r: Receipt, cold: boolean, at: number): Promise<void> {
  if (!sessionId) return
  const today = dayOf(at, offsetAt(at))
  const key = `d:${today}:${sessionId}`
  try {
    const old = ((await $.store.get(key)) ?? {}) as Record<string, number>
    await $.store.set(key, {
      cost: (old.cost ?? 0) + (r.cost ?? 0), turns: (old.turns ?? 0) + 1, tools: (old.tools ?? 0) + r.tools,
      colds: (old.colds ?? 0) + (cold ? 1 : 0), agents: (old.agents ?? 0) + r.agents,
    })
    await refreshLedger($, at)
  } catch {
    // the store is full or unwritable: the line and pane go on without it
  }
}

async function refreshLedger($: EngineInterface, at: number): Promise<void> {
  const today = dayOf(at, offsetAt(at))
  const keys = (await $.store.keys()).filter(key => key.startsWith('d:'))
  const recent = keys.filter(key => !staleKeys([key], today, 7).length)
  const entries = await Promise.all(recent.map(async key => ({ key, value: await $.store.get(key) })))
  const l = ledger(entries, today)
  await update($, ledgerAtom, () => l)
  if (config.budget && l.today.cost >= config.budget && (await once($, `budget:${today}`))) {
    await heads($, `Today's usage across sessions reached ${money(l.today.cost)} at API prices, past your ${money(config.budget)} budget.`, 'Daily budget', false)
  }
}

async function pruneLedger($: EngineInterface): Promise<void> {
  try {
    const at = await nowMs($)
    const keys = await $.store.keys()
    for (const key of staleKeys(keys, dayOf(at, offsetAt(at)))) await $.store.delete(key)
    // `coach:five_hour:<resets at>` marks outlive their window by a day at most.
    for (const key of keys.filter(k => k.startsWith('coach:'))) {
      const resets = Number(key.split(':').pop())
      if (!Number.isFinite(resets) || resets * 1000 < at - 86_400_000) await $.store.delete(key)
    }
    await refreshLedger($, at)
  } catch {
    // best effort
  }
}

/** Reads what the engine knows now: the session's id, model, usage, git and agents. */
async function resync($: EngineInterface): Promise<void> {
  await setupLive($)
  try {
    const id = await $.session.model()
    await update($, snap, s => ({ ...s, model: s.model ?? id }))
  } catch {
    // the first request names the model
  }
  await Promise.all([measure($).catch(() => undefined), refreshGit($), refreshAccount($), refreshAgents($), pruneLedger($)])
}

async function heartbeat($: EngineInterface): Promise<void> {
  beats += 1
  await markLive($)
  await update($, tick, () => beats)
  await nudge($)
  if (beats % 2 === 0) await refreshGit($)
  if (beats % 40 === 0 || (accountMissed && beats % 4 === 0)) await refreshAccount($)
  if (beats % 20 === 0) void refreshPulse($)
  if (beats % 8 === 0) await watchIdle($).catch(() => undefined)
  if ((await configStamp($)) !== stamp) await reloadConfig($)
  if ((await read($, agents)).some(row => isActive(row.status))) await refreshAgents($)
  await exportState($)
}

// ------------------------------------------------------------- the line

function layoutHas(key: string): boolean {
  if (key === 'git' && config.lines === 2) return config.git
  return layoutKeys({ now: 0, preset: config.preset, segments: config.segments }).flat().includes(key)
}

type Extras = Partial<Record<string, Segment | undefined>>

async function extrasNow($: EngineInterface): Promise<Extras> {
  const l = await read($, ledgerAtom)
  return {
    agents: agentsSegment(await read($, agents)),
    compact: forecastSegment(await read($, outlook)),
    today: todaySegment(l?.today, config.budget),
  }
}

/** The labels g-line adds to the footer's mode labels: what the layout doesn't place on the hint. */
function footerLabels(extras: Extras): string[] {
  if (!config.footerLabels || config.lines === 2) return []
  return (['agents', 'compact'] as const)
    .filter(key => !layoutHas(key))
    .map(key => extras[key]?.forms[0])
    .filter((label): label is string => Boolean(label))
}

// ---------------------------------------------------------------- the pane

type Row = { key: string; text: string; tone?: Tone; bold?: boolean }

function ago(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

const bar = (value: number, cells = 10) => {
  const filled = Math.max(0, Math.min(cells, Math.round(value * cells)))
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

async function detailRows($: EngineInterface, seconds: number, columns?: number): Promise<Row[]> {
  const s = await read($, snap)
  const p = payload(s, seconds, ttl, idle)
  const opts = { ...optionsAt(seconds), preset: 'full' as const, segments: undefined }
  const rows: Row[] = segments(p, opts).flat().map(row => ({ key: row.key, text: row.forms[0] ?? '', tone: row.tone }))
  for (const l of s.rateLimits ?? []) {
    if (!['five_hour', 'seven_day', 'spend_limit'].includes(l.kind)) rows.push({ key: `limit-${l.kind}`, text: `${l.kind.replace(/_/g, ' ')} ${pct(l.percentUsed)}` })
  }
  for (const alert of alerts(p, opts)) rows.push({ key: alert.id, text: alert.text, tone: 'warn' })

  const t = await read($, totals)
  const f = await read($, outlook)
  const now = seconds * 1000

  const list = await read($, agents)
  if (list.length) {
    rows.push({ key: 'h-agents', text: 'Agents', bold: true })
    for (const row of list.slice(-8)) {
      const age = ago((row.endedAt ?? now) - row.startedAt)
      const kind = row.teammate ? 'teammate' : row.type
      const model = row.model ? ` · ${modelName(row.model)}` : ''
      rows.push({ key: `a-${row.id}`, text: `${row.status.padEnd(9)} ${row.description.slice(0, 48)} (${kind}${model}, ${age})`,
        tone: row.status === 'failed' || row.status === 'killed' ? 'bad' : isActive(row.status) ? 'ok' : 'dim' })
    }
  }

  const recent = Object.values(await read($, receipts)).sort((x, y) => x.endAt - y.endAt).slice(-5)
  if (recent.length) {
    rows.push({ key: 'h-turns', text: 'Last turns', bold: true })
    for (const r of recent) {
      rows.push({ key: `t-${r.endAt}`, tone: 'dim',
        text: `${turnLength(r.durationMs).padStart(8)}${receiptText(r, RECEIPT_PRESETS.full ?? [], columns === undefined ? undefined : columns - 8)}` })
    }
  }

  const c = await read($, contextAtom)
  if (c) {
    rows.push({ key: 'h-context', text: `What fills the context (local estimate, ${tokens(c.total)} of ${tokens(c.max)})`, bold: true })
    for (const row of c.rows.slice(0, 7)) {
      rows.push({ key: `c-${row.name}`, text: `${bar(row.tokens / Math.max(1, c.total))} ${tokens(row.tokens).padStart(5)}  ${row.name}` })
    }
    if (c.memoryFiles) rows.push({ key: 'c-mem', tone: 'dim', text: `${c.memoryFiles} memory ${c.memoryFiles === 1 ? 'file' : 'files'}, ${tokens(c.memoryTokens)}` })
    if (c.skills) rows.push({ key: 'c-skills', tone: 'dim', text: `${c.skills.count} skills listed, ${tokens(c.skills.tokens)}` })
    for (const u of unusedServers(c, t.byTool).slice(0, 4)) {
      rows.push({ key: `c-mcp-${u.server}`, tone: 'warn', text: `MCP ${u.server}: ${tokens(u.tokens)} of tool definitions, none called this session` })
    }
    if (f) rows.push({ key: 'c-forecast', tone: f.turns <= 2 ? 'warn' : undefined, text: `${pct(f.percent)} of the auto-compact threshold; at this rate it compacts in ~${f.turns} turns` })
  }
  for (const k of t.compactions.slice(-3)) rows.push({ key: `k-${k.at}`, tone: 'dim', text: compactionText(k) })

  const tools = Object.entries(t.byTool).sort((x, y) => y[1].calls - x[1].calls).slice(0, 6)
  if (tools.length) {
    rows.push({ key: 'h-tools', text: `Tools (${t.tools} calls, ${t.failures} failed)`, bold: true })
    for (const [name, v] of tools) {
      rows.push({ key: `tool-${name}`, tone: v.failures ? 'warn' : 'dim', text: `${String(v.calls).padStart(4)}  ${name}${v.failures ? `  (${v.failures} failed)` : ''}` })
    }
  }

  const l = await read($, ledgerAtom)
  if (l && l.week.some(d => d.turns)) {
    rows.push({ key: 'h-day', text: 'Today and this week, every session on this machine', bold: true })
    rows.push({ key: 'd-today', text: `today ${money(l.today.cost)} at API prices · ${l.today.turns} turns · ${l.today.sessions} ${l.today.sessions === 1 ? 'session' : 'sessions'}${l.today.colds ? ` · ${l.today.colds} cold-cache rebuilds` : ''}` })
    const week = l.week.reduce((sum, d) => sum + d.cost, 0)
    rows.push({ key: 'd-week', text: `7 days ${spark(l.week.map(d => d.cost))} ${money(week)}` })
  }
  rows.push({ key: 'note', tone: 'dim', text: `Pace projects your average rate since each window opened. Totals count only sessions g-line ran in. Layout: ${layoutKeys(optionsAt(seconds)).map(x => x.join(',')).join(' | ')}.` })
  return rows
}

async function cardText($: EngineInterface, seconds: number): Promise<string[]> {
  const s = await read($, snap)
  const t = await read($, totals)
  const p = payload(s, seconds, ttl, idle)
  return cardLines({
    model: p.model?.display_name,
    elapsedSeconds: s.startedAt !== undefined ? seconds - s.startedAt / 1000 : undefined,
    totals: t, cost: s.costUsd,
    // Weighted by tokens over the whole session, not an average of turns.
    cacheHit: t.inputTokens ? ((t.cacheRead ?? 0) / t.inputTokens) * 100 : undefined,
    fiveHour: p.rate_limits?.five_hour?.used_percentage,
    agentsNow: (await read($, agents)).filter(row => isActive(row.status)).length,
    today: (await read($, ledgerAtom))?.today,
  })
}

async function openPane($: EngineInterface, mode: 'details' | 'card' | 'settings' | 'news'): Promise<Record<string, never>> {
  await update($, view, () => mode)
  await Promise.all([pruneLedger($), refreshGit($, true)])
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    const b = usage.context.breakdown
    if (b) {
      const at = await nowMs($)
      await update($, contextAtom, () => contextView(b, at))
    }
  } catch {
    // the pane shows the rest
  }
  void refreshPulse($)
  const title = mode === 'card' ? 'g-line card' : mode === 'settings' ? 'g-line settings' : mode === 'news' ? 'Pulse' : 'g-line'
  // The reader and the settings answer keys: they take the keyboard, asked for by the command.
  const opened = await $.ui.open({ id: PANE, title, ...(mode === 'news' || mode === 'settings' ? { focus: true as const, rows: 40 } : {}) })
  if (!opened.isPlaced) $.ui.toast('g-line: widen the terminal to see the pane.', { timeoutMs: 5000 })
  // Nothing goes back into the conversation: a command's text is read by Claude.
  return {}
}

// ------------------------------------------------------------------ pulse

/** Fetches g-line's static headline feed when it is on and the copy is old. Never on the drawing path. */
async function refreshPulse($: EngineInterface, force = false): Promise<void> {
  if (!config.pulse) return
  try {
    const at = await nowMs($)
    const held = await read($, pulseAtom)
    if (!force && held && at - held.fetchedAt < PULSE_TTL_MS) return
    const stored = (await $.store.get('pulse')) as { fetchedAt?: number; raw?: string } | undefined
    if (!force && stored?.raw && stored.fetchedAt && at - stored.fetchedAt < PULSE_TTL_MS) {
      const feed = parseFeed(stored.raw, stored.fetchedAt)
      if (feed) await update($, pulseAtom, () => feed)
      return
    }
    // One GET of a static file, nothing sent; given up after five seconds.
    const response = await Promise.race([$.http.fetch(PULSE_URL), $.clock.sleep(5000).then(() => undefined)])
    const feed = response && response.ok && response.text.length <= 262_144 ? parseFeed(response.text, at) : undefined
    if (feed) {
      await $.store.set('pulse', { fetchedAt: at, raw: response?.text })
      await update($, pulseAtom, () => feed)
    } else if (!held && stored?.raw && stored.fetchedAt) {
      // Offline: the last copy fetched, rather than nothing.
      const old = parseFeed(stored.raw, stored.fetchedAt)
      if (old) await update($, pulseAtom, () => old)
    }
  } catch {
    // offline or refused: the spinner and pane go on without headlines
  }
}

/** The feed less the sources the person muted: what the row and the spinner show. */
async function shownFeed($: EngineInterface): Promise<PulseFeed | null> {
  const feed = await read($, pulseAtom)
  if (!feed || !config.pulseMute.length) return feed
  return { ...feed, items: feed.items.filter(item => !muted(item, config.pulseMute)) }
}

/**
 * Mutes the item's source on Pulse's row and spinner, or unmutes whatever
 * mutes it; saved like any other choice. The reader keeps showing it.
 */
async function toggleMute($: EngineInterface, item: PulseItem): Promise<void> {
  const was = muted(item, config.pulseMute)
  await choose($, { pulse_mute: was ? config.pulseMute.filter(word => !muted(item, [word])) : [...config.pulseMute, item.source] })
  $.ui.toast(was ? `${item.source} is back on Pulse.` : `Muted ${item.source} on Pulse's row and spinner; m here unmutes it.`, { timeoutMs: 5000 })
}

/** The item Pulse's row shows now. */
async function shownItem($: EngineInterface): Promise<PulseItem | undefined> {
  const feed = await shownFeed($)
  if (!feed?.items.length) return undefined
  return feed.items[(await read($, turnover)) % feed.items.length]
}

/**
 * Pulse's row under the prompt, while Pulse is on: whose post, how long ago,
 * and the headline as a link (cmd-click or ctrl-click opens it where the
 * terminal draws OSC 8 links). It moves to the next item every 8 or 40 seconds
 * (`pulse_speed`), or holds one while paused; muted sources are skipped.
 */
async function pulseLine($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], columns: number | undefined): Promise<JSX.Element | null> {
  if (!config.pulse || config.lines === 0 || columns === undefined) return null
  const feed = await shownFeed($)
  if (!feed?.items.length) return null
  const item = feed.items[(await read($, turnover)) % feed.items.length]
  const row = pulseRow(item, columns - 4, await nowMs($))
  if (!item || !row) return null
  const { Box, Text, Link } = $.ui.resolve(e)
  return (
    <Box key="pulse" flexDirection="row">
      {row.lead ? <Text dimColor>{`${row.lead}: `}</Text> : null}
      {(await drawsLinks($)) ? <Link href={item.url} label={row.title} /> : <Text wrap="truncate-end">{row.title}</Text>}
      {row.tail ? <Text dimColor>{row.tail}</Text> : null}
    </Box>
  )
}

/**
 * Whether the terminal draws OSC 8 links. Where it doesn't, the engine prints
 * a link's URL after its text, which pushes Pulse's row onto a second line, so
 * the headline is drawn as plain text there and `/g-line open` opens it.
 * Inside tmux, links need a tmux setting, so plain text too.
 */
async function drawsLinks($: EngineInterface): Promise<boolean> {
  if (await $.env.get('TMUX')) return false
  const program = (await $.env.get('TERM_PROGRAM')) ?? ''
  return ['ghostty', 'iTerm.app', 'WezTerm', 'vscode'].includes(program)
}

/** Moves Pulse's row on to the next item, while there is a row to move. */
async function turnPulse($: EngineInterface): Promise<void> {
  if (!config.pulse || config.lines === 0 || (await read($, hidden))) return
  const beats = PULSE_BEATS[config.pulseSpeed]
  pulseBeats += 1
  if (beats === 0 || pulseBeats % beats !== 0) return
  const feed = await shownFeed($)
  if (feed && feed.items.length > 1) await update($, turnover, n => n + 1)
}

/**
 * Opens a link in the browser where the session runs on this machine: `open`
 * on macOS, `xdg-open` elsewhere. Over SSH, or when neither works, the link
 * is copied instead, which reaches the clipboard of the terminal in front of you.
 */
async function openLink($: EngineInterface, url: string, surface?: string): Promise<void> {
  const safe = safeUrl(url)
  if (!safe) return
  const remote = !!((await $.env.get('SSH_CONNECTION')) || (await $.env.get('SSH_TTY')))
  if (!remote) {
    for (const opener of ['open', 'xdg-open']) {
      try {
        const ran = await $.process.run([opener, safe], { timeoutMs: 4000 })
        if (ran.exitCode === 0) {
          $.ui.toast(`Opened ${hostOf(safe)} in your browser.`, { timeoutMs: 3000 })
          return
        }
      } catch {
        // try the next opener
      }
    }
  }
  const copied = await $.ui.copy({ text: safe, ...(surface ? { surface } : {}) } as never)
  $.ui.toast(copied.isCopied ? `Link copied (${remote ? 'this session runs over SSH' : 'no browser to open here'}): ${safe}` : safe, { timeoutMs: 8000 })
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** When the reader was last opened, and what it held then: items newer are marked new. */
const NEWS_SEEN = 'news_seen'
let seenBefore = 0

/** Posted after the reader was last opened. */
function isNew(item: PulseItem): boolean {
  if (!seenBefore || !item.at) return false
  const at = Date.parse(item.at)
  return Number.isFinite(at) && at > seenBefore
}

async function openNews($: EngineInterface): Promise<Record<string, never>> {
  try {
    seenBefore = Number((await $.store.get(NEWS_SEEN)) ?? 0) || 0
    await $.store.set(NEWS_SEEN, await nowMs($))
  } catch {
    // every item reads as seen
  }
  await update($, newsAt, () => 0)
  if (!config.pulse) {
    $.ui.toast('Pulse is off, so there is no news yet. /g-line set pulse on turns it on.', { timeoutMs: 8000 })
    return {}
  }
  await refreshPulse($)
  return openPane($, 'news')
}

/** A setting changed from the pane or a command: applied now, kept for later sessions. */
async function setSetting($: EngineInterface, setting: Setting, value: boolean | string): Promise<void> {
  await choose($, patchOf(setting, value))
}

/** Registers the `status` tool Claude can call; from the next prompt on. */
async function registerStatus($: EngineInterface): Promise<void> {
  try {
    // Deferred where tool search is available: Claude sees the name and
    // loads the description when it looks for such a tool.
    await $.tool.register({ name: STATUS_TOOL, description: STATUS_DESCRIPTION, inputSchema: STATUS_SCHEMA, isDeferred: true })
    statusRegistered = true
  } catch {
    // the line and the rest work without the tool
  }
}

// ---------------------------------------------------------------- command

const HELP = 'Open the g-line pane; `news` reads Pulse, `open` opens the headline shown, `settings` lists every setting, `set <name> on|off`, `reset [name]`, `card`, `off`/`on`'

/** `/g-line [settings|set|reset|card|off|on]`, and the 0.4 name for one release. Nothing goes back into the conversation. */
async function runCommand($: EngineInterface, e: { command: string; args: string }): Promise<Record<string, never>> {
  if (e.command === OLD_COMMAND) $.ui.toast('glanceline is now g-line: use /g-line. /glanceline works until the next release.', { timeoutMs: 8000 })
  const asked = parseCommand(e.args)
  switch (asked.kind) {
    case 'show':
    case 'hide':
      await update($, hidden, () => asked.kind === 'hide')
      $.ui.toast(asked.kind === 'hide' ? 'g-line hidden, and quiet until /g-line on.' : 'g-line shown.', { timeoutMs: 5000 })
      return {}
    case 'set': {
      const value = asked.value === 'toggle' ? nextValue(asked.setting, config) : asked.value
      await setSetting($, asked.setting, value)
      $.ui.toast(changedText(asked.setting), { timeoutMs: 8000 })
      return {}
    }
    case 'all': {
      let patch: Record<string, unknown> = {}
      for (const setting of SETTINGS) if (setting.kind === 'toggle') patch = withPatch(patch, patchOf(setting, asked.value))
      await choose($, patch)
      $.ui.toast(`Every g-line toggle is ${asked.value ? 'on' : 'off'}. /g-line reset goes back to your files and the defaults.`, { timeoutMs: 8000 })
      return {}
    }
    case 'reset': {
      const held = layers.find(layer => layer.name === CHOSEN)?.raw
      let saved = (held && typeof held === 'object' ? held : {}) as Record<string, unknown>
      try {
        saved = ((await $.store.get(SETTINGS_KEY)) ?? {}) as Record<string, unknown>
      } catch {
        // what this session holds
      }
      await keep($, asked.setting ? withoutSetting(saved, asked.setting) : {})
      $.ui.toast(asked.setting
        ? `${asked.setting.label}: ${said(asked.setting, config)}, from ${originOf(asked.setting, layers)}.`
        : 'Choices made with /g-line cleared: your config files, /config and the defaults decide again.', { timeoutMs: 8000 })
      return {}
    }
    case 'error':
      $.ui.toast(asked.text, { timeoutMs: 10_000 })
      return {}
    case 'settings':
      return openPane($, 'settings')
    case 'news':
      return openNews($)
    case 'open': {
      const item = await shownItem($)
      if (item) await openLink($, item.url)
      else $.ui.toast(config.pulse ? 'No headline yet: the feed is still on its way.' : 'Pulse is off. /g-line set pulse on turns it on.', { timeoutMs: 6000 })
      return {}
    }
    case 'card':
      return openPane($, 'card')
    default:
      return openPane($, 'details')
  }
}

// -------------------------------------------------------------- register

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    startOptions = options as Record<string, unknown>
    ;({ config, layers } = await loadConfig($, startOptions))
    stamp = await configStamp($)
    ttl = await explicitTtl($, config)
    idle = await idleCompactionOf($)
    if (config.claudeReads) await registerStatus($)
    for (const [name, description] of [
      [COMMAND, HELP],
      [OLD_COMMAND, 'Renamed to /g-line; this name works until the next release'],
    ] as const) {
      try {
        await $.command.register({ name, description, argumentHint: '[news|open|settings|set <name> on|off|reset|card|off|on]' })
      } catch {
        // the line and toasts work without the command
      }
    }
    void refreshPulse($)
    await resync($)
    $.clock.every(TICK_MS, () => void heartbeat($))
    $.clock.every(PULSE_EVERY_MS, () => void turnPulse($))
    return next(e)
  })

  // A /clear starts a new conversation in the same process, with no
  // `session.start`: read the fresh session's figures straight away.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      // The cleared conversation's cache says nothing about the next one.
      await update($, snap, s => ({ ...s, cache: undefined }))
      $.clock.after(300, () => void resync($))
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const limits = limitsOf(e.rateLimits)
    await update($, snap, s => ({
      ...s,
      context: { tokens: e.context.tokens, window: e.context.window, percent: e.context.percent },
      rateLimits: limits,
      costUsd: e.cost?.usd ?? s.costUsd,
      peaks: peaksOf(s, limits),
      cache: shrunk(s.cache, e.context.tokens),
    }))
    void nudge($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    let costAt: number | undefined
    let contextAt: number | undefined
    try {
      const usage = await $.session.usage()
      costAt = usage.cost?.usd ?? 0
      contextAt = usage.context.tokens
    } catch {
      // the receipt leaves cost and context out
    }
    coldThisTurn = false
    const startAt = await nowMs($)
    const warmBefore = (await read($, snap)).cache?.cached === true
    const overlap = (await read($, agents)).some(row => row.background && isActive(row.status))
    await update($, turnNow, () => ({ id: e.turnId, startAt, costAt, contextAt, tools: 0, agents: 0, failures: 0,
      cacheWrite: 0, warmBefore, overlap }))
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
        // After a compaction the old prefix is gone: this write is the summary,
        // neither a lifetime to learn from nor a cold rebuild.
        const fresh = s.cache?.compactedTo !== undefined
        const gap = s.cache && !fresh ? started - s.cache.lastAt : 0
        if (s.cache?.cached && gap > 330 && gap < 3500) {
          // After 5+ idle minutes a read means the hour TTL; a full rewrite of
          // a large prefix means five minutes.
          if (u.cache_read_input_tokens > s.cache.prefix * 0.5) learned = '1h'
          else if (u.cache_creation_input_tokens > s.cache.prefix * 0.5) learned = '5m'
        }
        const life = (learned ?? ttl ?? automaticTtl(s)) === '1h' ? 3600 : 300
        if (s.cache?.cached && gap > life && u.cache_creation_input_tokens > s.cache.prefix * 0.5) coldThisTurn = true
        return { ...s, model: e.model, effort: typeof e.effort === 'string' ? e.effort : s.effort,
          cache: { lastAt: started, cached, prefix, learned } }
      })
      const cold = coldThisTurn
      await update($, turnNow, live => (live ? { ...live, cold: live.cold || cold,
        cacheWrite: Math.max(live.cacheWrite ?? 0, u.cache_creation_input_tokens),
        contextGrowth: live.contextAt !== undefined ? prefix - live.contextAt : live.contextGrowth } : live))
      await update($, totals, t => ({ ...t, cacheRead: (t.cacheRead ?? 0) + u.cache_read_input_tokens,
        inputTokens: (t.inputTokens ?? 0) + u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens }))
    }
    return result
  })

  // Claude's own read of the budget: the `glance` tool's answer.
  on('tool.call', { tool: /^mcp__g-line__status$/ }, async ($, e) => {
    if (!config.claudeReads) return { result: STATUS_OFF, text: STATUS_OFF }
    const seconds = await nowSeconds($)
    const s = await read($, snap)
    const c = await read($, contextAtom)
    const text = statusJson({
      p: payload(s, seconds, ttl, idle), now: seconds, observedAt: s.cache?.lastAt,
      compactAt: c?.threshold, compactOn: c ? c.threshold !== undefined : undefined,
      section: typeof (e as unknown as Record<string, unknown>).section === 'string' ? String((e as unknown as Record<string, unknown>).section) : undefined,
      disabled: await read($, hidden),
    })
    return { result: text, text }
  }).catch(() => ({ result: UNREADABLE, text: UNREADABLE }))

  // Observes every tool call (never gates or rewrites one): counts, failures,
  // and a toast when the same call fails several times in a row.
  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined && e.tool !== 'Agent') await update($, turnNow, live => (live ? { ...live, tools: live.tools + 1 } : live))
    const result = await next(e)
    if (result.deny !== undefined || e.tool === 'Agent') return result
    const failed = result.isError === true
    const tool = String(e.tool)
    await update($, totals, t => {
      const was = t.byTool[tool] ?? { calls: 0, failures: 0 }
      return { ...t, tools: t.tools + 1, failures: t.failures + (failed ? 1 : 0),
        byTool: { ...t.byTool, [tool]: { calls: was.calls + 1, failures: was.failures + (failed ? 1 : 0) } } }
    })
    if (failed && e.agentId === undefined) {
      const what = target(tool, e as unknown as Record<string, unknown>)
      await update($, turnNow, live => (live ? { ...live, failures: (live.failures ?? 0) + 1,
        failedTool: live.failedTool === undefined || live.failedTool === tool ? tool : null,
        failedTarget: live.failedTarget === undefined || live.failedTarget === what ? what : null } : live))
    }
    if (config.toolStreak > 0) {
      const what = target(tool, e as unknown as Record<string, unknown>)
      const key = `${e.agentId ?? 'main'}|${tool}|${what}`
      const streak = failed ? (streaks.get(key) ?? 0) + 1 : 0
      if (failed) streaks.set(key, streak)
      else streaks.delete(key)
      if (streak === config.toolStreak) await toast($, loopWarning(tool, what, streak), 12_000)
    }
    return result
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId === undefined) return result
    const at = await nowMs($)
    const row: AgentRow = { id: result.agentId, description: e.description, type: e.subagentType, model: result.model,
      status: 'running', background: e.background, teammate: e.isTeammate === true, startedAt: at }
    await update($, agents, list => [...list.filter(one => one.id !== row.id), row].slice(-50))
    await update($, totals, t => ({ ...t, agents: t.agents + 1 }))
    if (e.parentAgentId === undefined) {
      await update($, turnNow, live => (live ? { ...live, agents: live.agents + 1, overlap: live.overlap || e.background === true } : live))
    }
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await refreshAgents($)
      return next(e)
    }
    // The closing line is appended while this hook runs: the append waits
    // for this promise, so the line is drawn with its receipt.
    const ready = receiptOf($, e)
    pending = ready
    const r = await ready
    await update($, turnNow, () => null)
    // The rest takes a moment (a local context count, the day's ledger), so it
    // runs after the turn's closing line is drawn, not before.
    $.clock.after(1, () => void afterTurn($, r, e.isAborted))
    void refreshGit($)
    void refreshAgents($)
    return next(e)
  })

  // The turn's closing line is appended right after `turn.complete`: its id
  // is the one the line's `TurnDuration` drawing carries.
  on('session.append', { door: 'notice' }, async ($, e, next) => {
    if (e.agentId === undefined && e.message.name === 'turn_duration' && pending) {
      const ready = pending
      pending = undefined
      const r = await Promise.race([ready.catch(() => undefined), $.clock.sleep(1500).then(() => undefined)])
      if (r) await update($, receipts, all => {
        const kept = Object.entries(all).sort((x, y) => x[1].endAt - y[1].endAt).slice(-199)
        return { ...Object.fromEntries(kept), [e.uuid]: r }
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.trigger === 'precompute' || result.messages === undefined) return result
    const c = { at: await nowMs($), trigger: e.trigger, before: result.tokensBefore, after: result.tokensAfter }
    await update($, totals, t => ({ ...t, compactions: [...t.compactions, c].slice(-20), growth: [] }))
    await update($, outlook, () => null)
    await markCompacted($, c.after)
    await update($, turnNow, live => (live ? { ...live, compacted: { before: c.before, after: c.after } } : live))
    await toast($, compactionText(c), 8000)
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: COMMAND }, async ($, e) => runCommand($, e))
  on('command.run', { command: OLD_COMMAND }, async ($, e) => runCommand($, e))

  // The line under the prompt: Claude Code keeps its own hint line (its mode
  // label and pills stay live) and draws this text, dim, at its end.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    lastHint = e.props.hint
    if (await read($, hidden)) return next(e)
    await read($, tick)
    const seconds = await nowSeconds($)
    const s = await read($, snap)
    const extras = await extrasNow($)
    if (config.lines === 0) return next(e)
    if (config.lines === 2) {
      // Line 1 rides at the end of the hint line, drawn dim by the engine.
      // Line 2 is the mod's own row directly under it, in colour. The mode
      // label the engine draws before the hint is the engine's: a mod can
      // shorten the hint's words but not that label.
      const columns = e.viewport?.columns
      const extra = [extras.agents, extras.compact, config.budget ? extras.today : undefined, config.git ? gitSegmentOf(s.git) : undefined, accountSegment(s.account)]
        .filter((one): one is Segment => one !== undefined)
      // The hint stays whole here: a rewritten hint has the engine draw its
      // mode label in a column of its own, which would squeeze line 2 into
      // the hint's column.
      const d = deck(payload(s, seconds, ttl, idle), optionsAt(seconds),
        { now: tailRoom(columns, e.props.hint), next: nextRoom(columns) }, extra)
      const engine = await next({ ...e, props: withText(e.props, joined(d.now), false) })
      const pulse = await pulseLine($, e, columns)
      if (!d.next.length && !pulse) return engine
      const { Box, Text } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {engine}
          {d.next.length ? (
            <Box flexDirection="row">
              {d.next.map((part, index) => [
                index ? <Text key={`s${index}`} dimColor>{' · '}</Text> : null,
                <Text key={`p${index}`} wrap="truncate-end" dimColor={!part.tone || part.tone === 'dim'}
                  bold={part.tone === 'bad'} color={part.tone ? COLORS[part.tone] : undefined}>{part.text}</Text>,
              ])}
            </Box>
          ) : null}
          {pulse}
        </Box>
      )
    }
    const labels = footerLabels(extras)
    const shown = e.props.tail ? e.props.hint : shownHint(e.props.hint, config.shortHints)
    const base = tailRoom(e.viewport?.columns, e.props.hint, shown)
    const room = base === undefined ? undefined : base - modesWidth(labels)
    // With a budget set, today's spend joins the line once it nears the budget.
    const trailing = config.budget && extras.today && extras.today.tone !== 'dim' && !layoutHas('today') ? [extras.today] : []
    const text = joined(inline(payload(s, seconds, ttl, idle), optionsAt(seconds), s.account, room, extras, trailing))
    const engine = await next(text ? { ...e, props: withText(e.props, text, config.shortHints) } : e)
    const pulse = await pulseLine($, e, e.viewport?.columns)
    if (!pulse) return engine
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {engine}
        {pulse}
      </Box>
    )
  })

  // The footer's mode labels: agents at work and when the context compacts,
  // each only while it has something to say.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (config.lines === 0 || (await read($, hidden))) return next(e)
    const labels = footerLabels(await extrasNow($))
    if (!labels.length) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...labels] } })
  })

  // The spinner: what the running turn has cost and done so far.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!config.spinner || (await read($, hidden))) return next(e)
    const live = await read($, turnNow)
    if (!live) return next(e)
    await read($, tick)
    const s = await read($, snap)
    const fiveHour = s.rateLimits?.find(l => l.kind === 'five_hour')?.percentUsed
    const parts = spinnerParts(live, fiveHour)
    const shown = e.props.message ?? e.props.word
    const lead = shown.endsWith('…') || shown.endsWith('...') ? '' : e.props.suffix
    let suffix = parts.length ? `${lead} · ${parts.join(' · ')}` : ''
    // With a footer, Pulse has its own row under the prompt; the spinner
    // carries a headline only in the receipts-only layout, so one shows at a time.
    if (config.pulse && config.lines === 0) {
      // The engine follows the suffix with its own `(38s · ↓ 1.2k tokens)`:
      // the headline takes what is left after keeping room for that.
      const columns = e.viewport?.columns ?? 0
      const room = columns - 4 - width(shown) - width(suffix || lead) - 3 - 34
      const now = await nowMs($)
      const ticker = tickerText(await shownFeed($), now - live.startAt, room, now, PULSE_BEATS[config.pulseSpeed])
      if (ticker) suffix = `${suffix || lead} │ ${ticker}`
    }
    if (!suffix) return next(e)
    return next({ ...e, props: { ...e.props, suffix } })
  })

  // The line that closes each turn: Claude Code's own words, then the turn's
  // receipt. The engine's drawing is kept whole; the receipt is laid over
  // the blank end of its row, starting where the engine's words stop.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (config.receipt.length === 0 || e.surface !== 'terminal' || (await read($, hidden))) return next(e)
    const r = (await read($, receipts))[e.requestId]
    if (!r) return next(e)
    const columns = e.viewport?.columns
    let done: string | undefined
    try {
      done = new Date(r.endAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    } catch {
      done = undefined
    }
    const own = turnLineWidth(e.props.word, e.props.durationMs, done)
    // Claude Code may add `· 1 shell still running` or `Waiting for 2
    // background agents to finish` when background work is left, words whose
    // width the mod is not told: then the receipt sits at the row's right end
    // and keeps BACKGROUND_ROOM columns clear for them, or is left out.
    const room = columns === undefined ? undefined : r.background ? columns - BACKGROUND_ROOM : columns - own - 1
    const parts = fitParts(receiptSpec(r, config.receipt), room)
    if (!parts.length) return next(e)
    const engine = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const place = r.background ? { right: 0 } : { left: own }
    return (
      <Box flexDirection="column">
        {engine}
        <Box position="absolute" bottom={0} {...place} flexDirection="row">
          {parts.map((part, index) => {
            const loud = part.tone === 'accent' || part.tone === 'warn' || part.tone === 'bad'
            return [
              <Text key={`s${index}`} dimColor>{SEP}</Text>,
              <Text key={`p${index}`} wrap="truncate-end" dimColor={!loud} bold={loud}
                color={loud && part.tone ? COLORS[part.tone] : undefined}>{part.text}</Text>,
            ]
          })}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, tick)
    const seconds = await nowSeconds($)
    const { Box, Text, Button } = $.ui.resolve(e)
    const show = (mode: 'details' | 'card' | 'settings' | 'news') => () => void update($, view, () => mode)
    if ((await read($, view)) === 'card') {
      const lines = await cardText($, seconds)
      const copy = async () => {
        const copied = await $.ui.copy({ text: `${lines.join('\n')}\n${INSTALL}\n`, surface: e.surface })
        $.ui.toast(copied.isCopied ? 'Card copied as text.' : 'Could not copy here; select the card text instead.', { timeoutMs: 5000 })
      }
      return (
        <Box flexDirection="column">
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            {lines.map((line, index) => (
              <Text key={`card-${index}`} bold={index === 0} color={index === 0 ? 'claude' : undefined} dimColor={index > 3}>{line}</Text>
            ))}
            <Text dimColor>{INSTALL}</Text>
          </Box>
          <Box flexDirection="row" gap={1}>
            <Button key="copy" label="Copy as text" hotkey="c" variant="primary" onPress={copy} />
            <Button key="details" label="Details" hotkey="d" onPress={show('details')} />
          </Box>
        </Box>
      )
    }
    if ((await read($, view)) === 'news') {
      const feed = await read($, pulseAtom)
      // The feed's own order: best first, as its editor ranked it.
      const items = feed?.items ?? []
      const now = await nowMs($)
      const { Link } = $.ui.resolve(e)
      const at = Math.min(await read($, newsAt), Math.max(0, items.length - 1))
      const columns = Math.max(20, (e.props.bodyColumns ?? 80) - 2)
      const rows = e.props.scroll?.bodyRows ?? 30
      const picked = items[at]
      // The picked item in full takes its wrapped text's rows and two more; each other takes three.
      const pickedRows = 2 + Math.ceil([...(picked?.text ?? picked?.title ?? '')].length / columns)
        + (picked?.story ? Math.ceil(([...picked.story].length + 2) / columns) : 0) + (picked?.discussion ? 1 : 0)
      const [start, end] = pageOf(items.length, at, Math.max(3, 1 + Math.floor((rows - 6 - pickedRows) / 3)))
      const fresh = items.filter(item => isNew(item)).length
      const move = (to: number) => () => void update($, newsAt, () => Math.max(0, Math.min(items.length - 1, to)))
      const selected = picked
      const updated = feed?.generatedAt ? Date.parse(feed.generatedAt) : Number.NaN
      const header = [
        items.length ? (end - start < items.length ? `${start + 1}–${end} of ${items.length}, best first` : `${items.length} items, best first`) : 'Nothing in the feed yet',
        Number.isFinite(updated) ? `updated ${ageOf({ title: '', url: '', source: '', at: feed?.generatedAt }, now)} ago` : '',
        fresh ? `${fresh} new since you last looked` : '',
      ].filter(Boolean).join(' · ')
      return (
        <Box flexDirection="column">
          <Text dimColor>{clean(header, columns)}</Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
            <Button key="open" label="Open" hotkey="o" plain onPress={() => void (selected && openLink($, selected.url, e.surface))} />
            <Button key="next" plain label="Next" hotkey="j" onPress={move(at + 1)} />
            <Button key="previous" plain label="Prev" hotkey="k" onPress={move(at - 1)} />
            <Button key="copy" plain label="Copy" hotkey="c" onPress={async () => {
              if (!selected) return
              const copied = await $.ui.copy({ text: selected.url, surface: e.surface })
              $.ui.toast(copied.isCopied ? 'Link copied.' : selected.url, { timeoutMs: 4000 })
            }} />
            {selected?.discussion ? (
              <Button key="discussion" plain label="Comments" hotkey="d" onPress={() => void (selected.discussion && openLink($, selected.discussion, e.surface))} />
            ) : null}
            {selected ? (
              <Button key="mute" plain label={muted(selected, config.pulseMute) ? 'Unmute' : 'Mute source'} hotkey="m"
                onPress={() => void toggleMute($, selected)} />
            ) : null}
            <Button key="refresh" plain label="Refresh" hotkey="r" onPress={() => void refreshPulse($, true)} />
            <Button key="close" plain label="Close" hotkey="q" onPress={() => void $.ui.close({ id: PANE })} />
          </Box>
          {items.slice(start, end).map((item, offset) => {
            const index = start + offset
            const chosen = index === at
            const who = item.author && item.source.startsWith('𝕏 @') ? `𝕏 ${clean(item.author, 24)} ${item.source.replace(/^𝕏 /, '')}`
              : item.via ? `${item.source} via ${item.via}` : item.source
            const meta = [who, ageOf(item, now), item.likes !== undefined ? `♥ ${countOf(item.likes)}` : '',
              item.points !== undefined ? `▲ ${countOf(item.points)}` : ''].filter(Boolean).join(' · ')
            return (
              <Box key={`news-${index}`} flexDirection="column" marginTop={offset ? 1 : 0}>
                <Button key={`item-${index}`} plain onPress={() => void (chosen ? openLink($, item.url, e.surface) : move(index)())}>
                  <Text color={chosen ? 'claude' : undefined}>{chosen ? '▸ ' : '  '}</Text>
                  <Text bold={chosen} dimColor={muted(item, config.pulseMute)}>{clean(chosen ? meta : item.title, columns - (isNew(item) ? 6 : 2) - (muted(item, config.pulseMute) ? 6 : 0))}</Text>
                  {isNew(item) ? <Text color="claude">{' new'}</Text> : null}
                  {muted(item, config.pulseMute) ? <Text dimColor>{' muted'}</Text> : null}
                </Button>
                {chosen ? (
                  <Box flexDirection="column" paddingLeft={2}>
                    {item.text && !item.text.startsWith(item.title.replace(/…$/, '')) ? <Text bold>{item.title}</Text> : null}
                    {item.story ? <Text dimColor>{`↳ ${item.story}`}</Text> : null}
                    <Text>{item.text ?? item.title}</Text>
                    <Link href={item.url} label={clean(item.url.replace(/^https:\/\/(www\.)?/, ''), columns - 2)} />
                    {item.discussion ? <Link href={item.discussion} label="Comments on Hacker News" /> : null}
                  </Box>
                ) : (
                  <Box paddingLeft={2}><Text dimColor>{clean(meta, columns - 2)}</Text></Box>
                )}
              </Box>
            )
          })}
        </Box>
      )
    }
    if ((await read($, view)) === 'settings') {
      // A narrow pane keeps each setting to one row: its value and where it comes from.
      const wide = (e.props.bodyColumns ?? 0) >= 110
      // Room to breathe between groups when the pane is tall enough for every row and the gaps.
      const airy = (e.props.scroll?.bodyRows ?? 0) >= SETTINGS.length + GROUPS.length * 2 + 5
      const pad = Math.max(...SETTINGS.map(setting => setting.label.length))
      const width = Math.max(...SETTINGS.map(setting => said(setting, config).length)) + 2
      const button = (setting: Setting) => {
        const value = said(setting, config)
        const tone = value === 'on' ? 'success' : undefined
        return (
          <Box key={`row-${setting.key}`} flexDirection="row">
            <Button key={`set-${setting.key}`} plain label={setting.label.padEnd(pad)} hotkey={setting.hotkey}
              onPress={() => void setSetting($, setting, nextValue(setting, config))} />
            <Text color={tone} dimColor={value === 'off'}>{`  ${value.padEnd(width)}`}</Text>
            <Text dimColor wrap="truncate-end">{`${changed(setting, config) ? '• ' : '  '}${originOf(setting, layers)}${wide ? ` · ${setting.help}` : ''}`}</Text>
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          <Text dimColor>{clean('A key flips a setting now, in every open session. • = not the default', Math.max(20, (e.props.bodyColumns ?? 80) - 1))}</Text>
          {GROUPS.map(group => (
            <Box key={`group-${group}`} flexDirection="column" marginTop={airy ? 1 : 0}>
              <Text bold>{group}</Text>
              {SETTINGS.filter(setting => setting.group === group).map(button)}
            </Box>
          ))}
          <Box flexDirection="row" gap={2} marginTop={airy ? 1 : 0}>
            <Button key="details" plain label="Back" hotkey="d" onPress={show('details')} />
            <Button key="reset" plain label="Clear my choices" hotkey="z"
              onPress={async () => {
                await keep($, {})
                $.ui.toast('Choices made with /g-line cleared: your config files, /config and the defaults decide again.', { timeoutMs: 8000 })
              }} />
            <Button key="close" plain label="Close" hotkey="q" onPress={() => void $.ui.close({ id: PANE })} />
          </Box>
          <Text dimColor>Or type /g-line set pulse on. config.json is ~/.config/g-line/config.json, read again within 15 s of an edit.</Text>
        </Box>
      )
    }
    const rows = await detailRows($, seconds, e.props.bodyColumns)
    const account = (await read($, snap)).account
    const feed = config.pulse ? await shownFeed($) : null
    const now = await nowMs($)
    const { Link } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={2}>
          {QUICK.map(setting => (
            <Button key={`set-${setting.key}`} plain label={`${setting.label} ${said(setting, config)}`} hotkey={setting.hotkey}
              onPress={() => void setSetting($, setting, nextValue(setting, config))} />
          ))}
          <Button key="settings" plain label="All settings" hotkey="s" onPress={show('settings')} />
        </Box>
        {feed && feed.items.length ? (
          <Box key="h-pulse" flexDirection="row" gap={1}>
            <Text bold>Pulse</Text>
            <Button key="news" plain label={`Read all ${feed.items.length}`} hotkey="n" onPress={() => void openNews($)} />
          </Box>
        ) : null}
        {feed ? feed.items.slice(0, 5).map((item, index) => (
          <Box key={`pulse-${index}`} flexDirection="row" gap={1}>
            <Button key={`pulse-copy-${index}`} label="copy" hotkey={String(index + 1)} plain
              onPress={async () => {
                const copied = await $.ui.copy({ text: item.url, surface: e.surface })
                $.ui.toast(copied.isCopied ? 'Link copied.' : item.url, { timeoutMs: 4000 })
              }} />
            <Link href={item.url} label={item.title} />
            <Text dimColor>{xLead(item, now) || item.source}</Text>
          </Box>
        )) : null}
        {rows.map(row => (
          <Text key={row.key} bold={row.bold} color={row.tone ? COLORS[row.tone] : undefined} dimColor={row.tone === 'dim'}>
            {row.text}
          </Text>
        ))}
        {account ? <Text dimColor>{account}</Text> : null}
        <Box flexDirection="row">
          <Button key="card" label="Share card" hotkey="c" onPress={show('card')} />
        </Box>
      </Box>
    )
  })
}
