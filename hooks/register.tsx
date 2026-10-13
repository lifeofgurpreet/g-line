// glanceline, the mod: your session at a glance without a single extra row.
//
// The live figures ride on lines Claude Code already draws: the hint line
// under the prompt (context, 5-hour and weekly limits with pace, cache, git),
// the footer's mode labels (agents at work, when the context will compact),
// the working spinner (what the turn has cost so far) and the line that
// closes each turn (`Baked for 1m 4s · $0.38 · 94% cached · 7 tools`).
// Heads-ups arrive as toasts and native notifications; everything else is in
// the `/glanceline` pane and its share card.
//
// Every figure is Claude Code's own (`$.session.usage()`, `session.measure`,
// `turn.complete`, `$.agent.list()`, `session.compact`, `tool.call`) or what
// the mod watched happen. No transcript is parsed, nothing is estimated that
// the engine reports, and nothing leaves the machine.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentRow, Receipt, Snap, Totals } from '../types'
import { alerts, layoutKeys, modelName, num, pct, segments, str, tokens, width } from './core'
import type { Options, Payload, Preset, Segment, Tone } from './core'
import {
  EMPTY_TOTALS, RECEIPT_PRESETS, agentsSegment, cacheHit, cardLines, coach, compactionText, contextView, dayOf,
  forecast, forecastSegment, isActive, isEnded, ledger, loopWarning, money, receiptFields, receiptText, spark,
  staleKeys, target, todaySegment, turnLength, turnLineWidth, unusedServers,
} from './extras'
import type { ReceiptField } from './extras'
import { MOD_KEYS, inline, joined, modesWidth, tailRoom } from './inline'

const snap = atom({ plugin: 'glanceline', key: 'snap' } as const, {})
const tick = atom({ plugin: 'glanceline', key: 'tick' } as const, 0)
const seen = atom({ plugin: 'glanceline', key: 'seen' } as const, [])
const hidden = atom({ plugin: 'glanceline', key: 'hidden' } as const, false)
const receipts = atom({ plugin: 'glanceline', key: 'receipts' } as const, {})
const turnNow = atom({ plugin: 'glanceline', key: 'turn' } as const, null)
const agents = atom({ plugin: 'glanceline', key: 'agents' } as const, [])
const totals = atom({ plugin: 'glanceline', key: 'totals' } as const, EMPTY_TOTALS)
const outlook = atom({ plugin: 'glanceline', key: 'forecast' } as const, null)
const contextAtom = atom({ plugin: 'glanceline', key: 'context' } as const, null)
const ledgerAtom = atom({ plugin: 'glanceline', key: 'ledger' } as const, null)
const view = atom({ plugin: 'glanceline', key: 'view' } as const, 'details')

const PANE = 'glanceline'
const INSTALL = '/plugin install glanceline --marketplace lifeofgurpreet/glanceline'
const TICK_MS = 15_000
/** A statusLine fallback steps aside while this session's file is under a minute old. */
const LIVE_DIR = '.cache/glanceline/live'
const STATE_DIR = '.cache/glanceline/state'

type Notify = { cache: boolean; reset: boolean; longTurn: boolean; agents: boolean }

type Config = {
  preset: Preset
  segments?: string
  icons: 'none' | 'nerd'
  toasts: boolean
  cacheTtl: 'auto' | '5m' | '1h'
  accountCommand?: string[]
  notify: Notify
  longTurnSeconds: number
  resetThreshold: number
  receipt: ReceiptField[]
  spinner: boolean
  footerLabels: boolean
  coach: boolean
  toolStreak: number
  budget?: number
  exportState: boolean
}

const DEFAULTS: Config = {
  preset: 'default', icons: 'none', toasts: true, cacheTtl: 'auto',
  notify: { cache: true, reset: true, longTurn: false, agents: false },
  longTurnSeconds: 60, resetThreshold: 80, receipt: RECEIPT_PRESETS.short ?? [], spinner: true, footerLabels: true,
  coach: true, toolStreak: 3, exportState: false,
}

const COLORS: Record<Tone, string | undefined> = {
  ok: 'success', warn: 'warning', bad: 'error', accent: 'claude', dim: undefined,
}

// ----------------------------------------------------------------- config

function merge(base: Config, raw: unknown): Config {
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const next = { ...base, notify: { ...base.notify } }
  if (r.preset === 'minimal' || r.preset === 'default' || r.preset === 'full') next.preset = r.preset
  if (typeof r.segments === 'string' && r.segments.trim()) next.segments = r.segments
  if (r.icons === 'none' || r.icons === 'nerd') next.icons = r.icons
  if (typeof r.toasts === 'boolean') next.toasts = r.toasts
  if (r.cache_ttl === '5m' || r.cache_ttl === '1h' || r.cache_ttl === 'auto') next.cacheTtl = r.cache_ttl
  const command = r.account_command
  if (Array.isArray(command) && command.length && command.every(word => typeof word === 'string')) {
    next.accountCommand = command as string[]
  }
  if (typeof r.notify === 'boolean') next.notify = { cache: r.notify, reset: r.notify, longTurn: r.notify && base.notify.longTurn, agents: r.notify && base.notify.agents }
  else if (r.notify && typeof r.notify === 'object') {
    const n = r.notify as Record<string, unknown>
    if (typeof n.cache === 'boolean') next.notify.cache = n.cache
    if (typeof n.reset === 'boolean') next.notify.reset = n.reset
    if (typeof n.long_turn === 'boolean') next.notify.longTurn = n.long_turn
    if (typeof n.agents === 'boolean') next.notify.agents = n.agents
  }
  const seconds = num(r.long_turn_seconds)
  if (seconds !== undefined && seconds >= 5) next.longTurnSeconds = seconds
  const threshold = num(r.reset_threshold)
  if (threshold !== undefined && threshold >= 0 && threshold <= 100) next.resetThreshold = threshold
  if (r.receipt !== undefined) next.receipt = r.receipt === false ? [] : receiptFields(r.receipt)
  if (typeof r.spinner === 'boolean') next.spinner = r.spinner
  if (typeof r.footer_labels === 'boolean') next.footerLabels = r.footer_labels
  if (typeof r.coach === 'boolean') next.coach = r.coach
  const streak = num(r.tool_streak)
  if (streak !== undefined && streak >= 0) next.toolStreak = Math.floor(streak)
  const budget = num(r.today_budget)
  if (budget !== undefined && budget > 0) next.budget = budget
  if (typeof r.export_state === 'boolean') next.exportState = r.export_state
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
  if (options.notifications === false) chosen.notify = false
  if (options.receipt !== undefined && options.receipt !== 'short') chosen.receipt = options.receipt
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
let liveFile: string | undefined
let stateFile: string | undefined
let sessionId: string | undefined
/** The receipt of the main-loop turn that just ended, until its closing line is appended. */
let pending: Promise<Receipt> | undefined
/** The hint line's last text: `1 shell` and the like say background work is running. */
let lastHint = ''
/** Whether this turn's first request rebuilt a cold cache. */
let coldThisTurn = false
/** Consecutive failures per agent, tool and target. */
const streaks = new Map<string, number>()

const BACKGROUND = /\b\d+ (?:shells?|monitors?|tasks?|agents?|workflows?|background)\b/i

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
    utcOffsetMinutes: offsetAt(seconds * 1000) }
}

/** A heads-up that reaches you in another app, or a toast when no channel takes it. */
async function heads($: EngineInterface, text: string, title: string, notify: boolean): Promise<void> {
  if (notify) {
    try {
      if ((await $.ui.notify(text, { title })).isSent) return
    } catch {
      // a hook refused it, or the write failed: fall back to the toast
    }
  }
  if (config.toasts) $.ui.toast(text, { timeoutMs: 12_000 })
}

/** Marks an id as handled; true the first time. */
async function once($: EngineInterface, id: string): Promise<boolean> {
  if ((await read($, seen)).includes(id)) return false
  await update($, seen, list => (list.includes(id) ? list : [...list, id].slice(-100)))
  return true
}

async function nudge($: EngineInterface): Promise<void> {
  const seconds = await nowSeconds($)
  const s = await read($, snap)
  const p = payload(s, seconds, ttl)
  for (const alert of alerts(p, optionsAt(seconds))) {
    if (!(await once($, alert.id))) continue
    if (alert.id.startsWith('cache:')) {
      await heads($, alert.text, 'Prompt cache', config.notify.cache)
      continue
    }
    const kind = alert.id.startsWith('five_hour') ? 'five_hour' : 'seven_day'
    const advice = config.coach ? coach(kind, p.rate_limits?.[kind], seconds, s.effort, offsetAt(seconds * 1000)) : undefined
    if (config.toasts) $.ui.toast(advice ? advice.text : alert.text, { timeoutMs: 15_000 })
    if (advice) await $.prompt.suggest({ text: advice.suggest }).catch(() => undefined)
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
 * Tells a glanceline (or CAAM) statusLine fallback in this session that the
 * mod draws it, so the same figures never show twice: the fallback reads the
 * file named after the session id it is handed, and steps aside while the
 * file is under a minute old. Nothing else is in it.
 */
async function markLive($: EngineInterface): Promise<void> {
  if (!liveFile) return
  try {
    await $.fs.write(liveFile, `${Math.floor(await nowSeconds($))}\n`)
  } catch {
    // unwritable home: the fallback keeps drawing, which is only redundant
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
    const p = payload(s, seconds, ttl)
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
  const active = (await read($, agents)).some(row => isActive(row.status))
  return {
    cost, context, cacheHit: e.usage ? cacheHit(e.usage) : undefined,
    tools: live?.tools ?? 0, agents: live?.agents ?? 0, output: e.usage?.output_tokens,
    endAt: await nowMs($), durationMs: e.durationMs, background: active || BACKGROUND.test(lastHint),
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
  const cold = coldThisTurn
  coldThisTurn = false
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
    if (config.toasts) {
      $.ui.toast(`Context compacts in ~${f.turns === 1 ? '1 turn' : `${f.turns} turns`}. To choose what's kept, run /compact with a note now${config.coach ? ' (Tab starts one)' : ''}.`, { timeoutMs: 15_000 })
    }
    if (config.coach) await $.prompt.suggest({ text: '/compact keep ' }).catch(() => undefined)
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
    for (const key of staleKeys(await $.store.keys(), dayOf(at, offsetAt(at)))) await $.store.delete(key)
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
  if (beats % 40 === 0) await refreshAccount($)
  if ((await read($, agents)).some(row => isActive(row.status))) await refreshAgents($)
  await exportState($)
}

// ------------------------------------------------------------- the line

function layoutHas(key: string): boolean {
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

/** The labels glanceline adds to the footer's mode labels: what the layout doesn't place on the hint. */
function footerLabels(extras: Extras): string[] {
  if (!config.footerLabels) return []
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
  const p = payload(s, seconds, ttl)
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
  rows.push({ key: 'note', tone: 'dim', text: `Pace projects your average rate since each window opened. Totals count only sessions glanceline ran in. Layout: ${layoutKeys(optionsAt(seconds)).map(x => x.join(',')).join(' | ')}.` })
  return rows
}

async function cardText($: EngineInterface, seconds: number): Promise<string[]> {
  const s = await read($, snap)
  const t = await read($, totals)
  const recent = Object.values(await read($, receipts))
  const hits = recent.map(r => r.cacheHit).filter((n): n is number => n !== undefined)
  const p = payload(s, seconds, ttl)
  return cardLines({
    model: p.model?.display_name,
    elapsedSeconds: s.startedAt !== undefined ? seconds - s.startedAt / 1000 : undefined,
    totals: t, cost: s.costUsd,
    cacheHit: hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : undefined,
    fiveHour: p.rate_limits?.five_hour?.used_percentage,
    agentsNow: (await read($, agents)).filter(row => isActive(row.status)).length,
    today: (await read($, ledgerAtom))?.today,
  })
}

async function openPane($: EngineInterface, mode: 'details' | 'card'): Promise<{ text: string }> {
  await update($, view, () => mode)
  await pruneLedger($)
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
  const opened = await $.ui.open({ id: PANE, title: mode === 'card' ? 'glanceline card' : 'glanceline' })
  if (!opened.isPlaced) return { text: 'glanceline: widen the terminal to see the pane.' }
  return { text: mode === 'card' ? 'share card opened; [ Copy as text ] copies it.' : 'details opened.' }
}

// -------------------------------------------------------------- register

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    config = await loadConfig($, options as Record<string, unknown>)
    ttl = await explicitTtl($, config)
    try {
      await $.command.register({
        name: 'glanceline',
        description: 'Open the glanceline pane; `card` for a share card, `off` hides the line, `on` shows it',
        argumentHint: '[card|off|on]',
      })
    } catch {
      // the line and toasts work without the command
    }
    await resync($)
    $.clock.every(TICK_MS, () => void heartbeat($))
    return next(e)
  })

  // A /clear starts a new conversation in the same process, with no
  // `session.start`: read the fresh session's figures straight away.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') $.clock.after(300, () => void resync($))
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
    await update($, turnNow, () => ({ id: e.turnId, startAt, costAt, contextAt, tools: 0, agents: 0 }))
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
        const life = (learned ?? ttl ?? automaticTtl(s)) === '1h' ? 3600 : 300
        if (s.cache?.cached && gap > life && u.cache_creation_input_tokens > s.cache.prefix * 0.5) coldThisTurn = true
        return { ...s, model: e.model, effort: typeof e.effort === 'string' ? e.effort : s.effort,
          cache: { lastAt: started, cached, prefix, learned } }
      })
    }
    return result
  })

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
    if (config.toolStreak > 0) {
      const what = target(tool, e as unknown as Record<string, unknown>)
      const key = `${e.agentId ?? 'main'}|${tool}|${what}`
      const streak = failed ? (streaks.get(key) ?? 0) + 1 : 0
      if (failed) streaks.set(key, streak)
      else streaks.delete(key)
      if (streak === config.toolStreak && config.toasts) $.ui.toast(loopWarning(tool, what, streak), { timeoutMs: 12_000 })
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
    if (e.parentAgentId === undefined) await update($, turnNow, live => (live ? { ...live, agents: live.agents + 1 } : live))
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
    if (config.toasts) $.ui.toast(compactionText(c), { timeoutMs: 8000 })
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'glanceline' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, hidden, () => arg === 'off')
      return { text: arg === 'off' ? 'glanceline line hidden. `/glanceline on` brings it back.' : 'glanceline line shown.' }
    }
    return openPane($, arg === 'card' ? 'card' : 'details')
  })

  // The line under the prompt: Claude Code keeps its own hint line (its mode
  // label and pills stay live) and draws this text, dim, at its end.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    lastHint = e.props.hint
    if (await read($, hidden)) return next(e)
    await read($, tick)
    const seconds = await nowSeconds($)
    const s = await read($, snap)
    const extras = await extrasNow($)
    const labels = footerLabels(extras)
    const base = tailRoom(e.viewport?.columns, e.props.hint)
    const room = base === undefined ? undefined : base - modesWidth(labels)
    // With a budget set, today's spend joins the line once it nears the budget.
    const trailing = config.budget && extras.today && extras.today.tone !== 'dim' && !layoutHas('today') ? [extras.today] : []
    const text = joined(inline(payload(s, seconds, ttl), optionsAt(seconds), s.account, room, extras, trailing))
    if (!text) return next(e)
    const tail = e.props.tail ? `${e.props.tail} · ${text}` : text
    return next({ ...e, props: { ...e.props, tail } })
  })

  // The footer's mode labels: agents at work and when the context compacts,
  // each only while it has something to say.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (await read($, hidden)) return next(e)
    const labels = footerLabels(await extrasNow($))
    if (!labels.length) return next(e)
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, ...labels] } })
  })

  // The spinner: what the running turn has cost and done so far.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (!config.spinner || (await read($, hidden))) return next(e)
    const live = await read($, turnNow)
    if (!live) return next(e)
    const s = await read($, snap)
    const parts: string[] = []
    if (live.costAt !== undefined && s.costUsd !== undefined && s.costUsd - live.costAt >= 0.01) parts.push(money(s.costUsd - live.costAt))
    if (live.tools) parts.push(`${live.tools} ${live.tools === 1 ? 'tool' : 'tools'}`)
    if (live.agents) parts.push(`${live.agents} ${live.agents === 1 ? 'agent' : 'agents'}`)
    if (!parts.length) return next(e)
    const shown = e.props.message ?? e.props.word
    const lead = shown.endsWith('…') || shown.endsWith('...') ? '' : e.props.suffix
    return next({ ...e, props: { ...e.props, suffix: `${lead} · ${parts.join(' · ')}` } })
  })

  // The line that closes each turn: Claude Code's own words, then the turn's
  // receipt. The engine's drawing is kept whole; the receipt is laid over
  // the blank end of its row, starting where the engine's words stop.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (!config.receipt.length || e.surface !== 'terminal' || (await read($, hidden))) return next(e)
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
    const text = receiptText(r, config.receipt, columns === undefined ? undefined : columns - own - 1)
    if (!text) return next(e)
    const engine = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    // Claude Code may add `· 1 shell still running` when background work is
    // left: then the receipt sits at the row's right end, clear of it.
    const place = r.background ? { right: 0 } : { left: own }
    return (
      <Box flexDirection="column">
        {engine}
        <Box position="absolute" bottom={0} {...place}>
          <Text dimColor wrap="truncate-end">{text}</Text>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, tick)
    const seconds = await nowSeconds($)
    const { Box, Text, Button } = $.ui.resolve(e)
    const show = (mode: 'details' | 'card') => () => void update($, view, () => mode)
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
    const rows = await detailRows($, seconds, e.props.bodyColumns)
    const account = (await read($, snap)).account
    return (
      <Box flexDirection="column">
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
