// What only the mod can show: a receipt for each turn, the agents running,
// when the context will compact, what fills it, repeated tool failures, the
// day's totals across sessions, a share card and a pace coach. Pure, like
// core.ts: the mod hands in what the engine reported, these turn it into
// words, and the tests call them directly.

import { SEP, clock, duration, pace, pct, tokens, width } from './core'
import type { Segment, Tone, Window } from './core'
import type { AgentRow, ContextView, Day, Forecast, Ledger, Receipt, Totals } from '../types'

export const EMPTY_TOTALS: Totals = {
  turns: 0, tools: 0, failures: 0, agents: 0, colds: 0, peakContext: 0, byTool: {}, compactions: [], growth: [],
}

export function emptyDay(day: string): Day {
  return { day, cost: 0, turns: 0, tools: 0, sessions: 0, colds: 0, agents: 0 }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// --------------------------------------------------------------- receipts

/** The fields a receipt can show, in the order they are written. */
export const RECEIPT_FIELDS = ['cost', 'cache', 'context', 'tools', 'agents', 'output'] as const
export type ReceiptField = (typeof RECEIPT_FIELDS)[number]
export const RECEIPT_PRESETS: Record<string, ReceiptField[]> = {
  short: ['cost', 'cache', 'tools'],
  full: ['cost', 'cache', 'context', 'tools', 'agents', 'output'],
  off: [],
}

/** `short`, `full`, `off`, or a comma list of fields. */
export function receiptFields(spec: unknown): ReceiptField[] {
  if (typeof spec !== 'string') return RECEIPT_PRESETS.short ?? []
  const preset = RECEIPT_PRESETS[spec.trim()]
  if (preset) return preset
  const picked = spec.split(',').map(s => s.trim()).filter((s): s is ReceiptField => (RECEIPT_FIELDS as readonly string[]).includes(s))
  return picked.length ? picked : RECEIPT_PRESETS.short ?? []
}

/** The share of a request's input the prompt cache served, 0 to 100. */
export function cacheHit(u: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): number | undefined {
  const total = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  return total > 0 ? (u.cache_read_input_tokens / total) * 100 : undefined
}

export function money(usd: number): string {
  if (usd < 0.005) return '<$0.01'
  return usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`
}

/** The receipt's parts, in field order; zero and unknown figures are left out. */
export function receiptParts(r: Receipt, fields: readonly ReceiptField[]): string[] {
  const parts: string[] = []
  for (const field of fields) {
    if (field === 'cost' && r.cost !== undefined && r.cost > 0) parts.push(money(r.cost))
    if (field === 'cache' && r.cacheHit !== undefined) parts.push(`${Math.floor(r.cacheHit)}% cached`)
    if (field === 'context' && r.context !== undefined && r.context !== 0) {
      parts.push(r.context > 0 ? `+${tokens(r.context)} context` : `−${tokens(-r.context)} context`)
    }
    if (field === 'tools' && r.tools > 0) parts.push(plural(r.tools, 'tool'))
    if (field === 'agents' && r.agents > 0) parts.push(plural(r.agents, 'agent'))
    if (field === 'output' && r.output) parts.push(`${tokens(r.output)} out`)
  }
  return parts
}

/** ` · $0.38 · 94% cached · 7 tools`, the last parts dropped to fit `room`. */
export function receiptText(r: Receipt, fields: readonly ReceiptField[], room?: number): string {
  const parts = receiptParts(r, fields)
  while (parts.length) {
    const text = SEP + parts.join(SEP)
    if (room === undefined || width(text) <= room) return text
    parts.pop()
  }
  return ''
}

/** A turn's length as Claude Code writes it on that line: `11s`, `1m 4s`, `1h 2m 3s`. */
export function turnLength(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = s % 60
  if (h) return `${h}h ${m}m ${rest}s`
  if (m) return `${m}m ${rest}s`
  return `${rest}s`
}

/** Columns Claude Code's own `✻ Baked for 3s · done 3:45 PM` takes, the glyph's two included. */
export function turnLineWidth(word: string, durationMs: number, doneAt?: string): number {
  return 2 + width(`${word} for ${turnLength(durationMs)}${doneAt ? ` · done ${doneAt}` : ''}`)
}

// ----------------------------------------------------------------- agents

const ACTIVE = new Set(['pending', 'running', 'waiting'])
const ENDED = new Set(['completed', 'failed', 'killed'])

export const isActive = (status: string) => ACTIVE.has(status)
export const isEnded = (status: string) => ENDED.has(status)

/** `agents 3 (2 running, 1 waiting)`, only while some are at work. */
export function agentsSegment(rows: readonly AgentRow[]): Segment | undefined {
  const active = rows.filter(row => isActive(row.status))
  if (!active.length) return undefined
  const running = active.filter(row => row.status !== 'waiting').length
  const waiting = active.length - running
  const detail = waiting && running ? ` (${running} running, ${waiting} waiting)` : waiting ? ' waiting' : ' running'
  return { key: 'agents', priority: 68, forms: [`agents ${active.length}${detail}`, `agents ${active.length}`, `ag ${active.length}`] }
}

// ------------------------------------------------------------- compaction

/**
 * When auto-compaction will run: the room left before its threshold over the
 * average context growth of the last turns. Undefined below 60% of the
 * threshold, with too little history, or when it is more than 30 turns off.
 */
export function forecast(contextTokens: number | undefined, threshold: number | undefined, growth: readonly number[]): Forecast | undefined {
  if (!contextTokens || !threshold || threshold <= 0) return undefined
  const percent = (contextTokens / threshold) * 100
  const recent = growth.slice(-5)
  if (percent < 60 || recent.length < 2) return undefined
  const average = recent.reduce((sum, n) => sum + Math.max(0, n), 0) / recent.length
  if (average <= 0) return undefined
  const turns = Math.max(1, Math.ceil((threshold - contextTokens) / average))
  return turns > 30 ? undefined : { turns, percent, threshold }
}

export function forecastSegment(f?: Forecast | null): Segment | undefined {
  if (!f) return undefined
  const tone: Tone | undefined = f.turns <= 2 ? 'warn' : undefined
  const n = f.turns === 1 ? 'next turn' : `~${f.turns} turns`
  return { key: 'compact', priority: 72, tone,
    forms: [f.turns === 1 ? 'compacts next turn' : `compacts in ~${f.turns} turns`, `compact ${n}`, `cmp ${f.turns}`] }
}

export function compactionText(c: { trigger: string; before?: number; after?: number }): string {
  const how = c.trigger === 'auto' ? 'automatically' : c.trigger === 'manual' ? 'by /compact' : `by ${c.trigger}`
  if (c.before && c.after !== undefined) return `Context compacted ${how}: ${tokens(c.before)} → ${tokens(c.after)} tokens.`
  return `Context compacted ${how}.`
}

// ----------------------------------------------------------- context view

type Breakdown = {
  categories: readonly { name: string; tokens: number; kind: string }[]
  totalTokens: number
  rawMaxTokens: number
  autoCompactThreshold?: number
  isAutoCompactEnabled: boolean
  mcpTools: readonly { serverName: string; tokens: number; isLoaded: boolean }[]
  memoryFiles: readonly { tokens: number }[]
  skills?: { includedSkills: number; tokens: number }
}

/** The breakdown, cut to what the pane shows: no file paths, no tool names. */
export function contextView(b: Breakdown, at: number): ContextView {
  const servers = new Map<string, { tokens: number; tools: number }>()
  for (const tool of b.mcpTools) {
    if (!tool.isLoaded) continue
    const s = servers.get(tool.serverName) ?? { tokens: 0, tools: 0 }
    servers.set(tool.serverName, { tokens: s.tokens + tool.tokens, tools: s.tools + 1 })
  }
  return {
    at, total: b.totalTokens, max: b.rawMaxTokens,
    threshold: b.isAutoCompactEnabled ? b.autoCompactThreshold : undefined,
    rows: b.categories.filter(c => c.kind === 'used' && c.tokens > 0).map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind }))
      .sort((x, y) => y.tokens - x.tokens),
    mcp: [...servers].map(([server, s]) => ({ server, ...s })).sort((x, y) => y.tokens - x.tokens),
    memoryFiles: b.memoryFiles.length,
    memoryTokens: b.memoryFiles.reduce((sum, f) => sum + f.tokens, 0),
    skills: b.skills ? { count: b.skills.includedSkills, tokens: b.skills.tokens } : undefined,
  }
}

/** The MCP servers whose tool definitions ride in the context but none of whose tools ran. */
export function unusedServers(view: ContextView, byTool: Totals['byTool']): { server: string; tokens: number }[] {
  const used = new Set(Object.keys(byTool).filter(t => t.startsWith('mcp__')).map(t => t.split('__')[1]))
  return view.mcp.filter(s => !used.has(s.server)).map(s => ({ server: s.server, tokens: s.tokens }))
}

// ------------------------------------------------------------ tool vitals

/** What a call worked on, short: a file's name, a command's first words. */
export function target(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  const path = pick('file_path') ?? pick('notebook_path') ?? pick('path')
  if (path) return path.split('/').filter(Boolean).pop() ?? path
  const command = pick('command')
  if (command) return command.trim().split(/\s+/).slice(0, 3).join(' ').slice(0, 40)
  const other = pick('pattern') ?? pick('url') ?? pick('query') ?? pick('skill')
  return other ? other.slice(0, 40) : tool
}

/** The toast after the same call has failed `streak` times in a row. */
export function loopWarning(tool: string, what: string, streak: number): string {
  const on = what && what !== tool ? ` on ${what}` : ''
  return `${tool} failed ${streak}× in a row${on}. Worth a look before it burns more of your limit.`
}

// ----------------------------------------------------------------- ledger

/** `2026-10-13` in the caller's zone. */
export function dayOf(ms: number, offsetMinutes = 0): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10)
}

const KEY = /^d:(\d{4}-\d{2}-\d{2}):/

/** Store keys from before `keepDays` days ago. */
export function staleKeys(keys: readonly string[], today: string, keepDays = 35): string[] {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - keepDays * 86_400_000).toISOString().slice(0, 10)
  return keys.filter(key => { const m = KEY.exec(key); return m !== null && (m[1] ?? '') < cutoff })
}

/** Today and the last seven days, each summed over the sessions' entries. */
export function ledger(entries: readonly { key: string; value: unknown }[], today: string): Ledger {
  const days: string[] = []
  for (let i = 6; i >= 0; i--) days.push(new Date(Date.parse(`${today}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10))
  const sums = new Map(days.map(day => [day, emptyDay(day)]))
  for (const { key, value } of entries) {
    const day = KEY.exec(key)?.[1]
    const sum = day ? sums.get(day) : undefined
    if (!sum || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const n = (k: string) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : 0)
    sum.cost += n('cost'); sum.turns += n('turns'); sum.tools += n('tools'); sum.colds += n('colds'); sum.agents += n('agents')
    sum.sessions += 1
  }
  const week = days.map(day => sums.get(day) ?? emptyDay(day))
  return { today: week[week.length - 1] ?? emptyDay(today), week }
}

/** `today $41` (`of $50` with a budget), for the line. */
export function todaySegment(day: Day | undefined, budget?: number): Segment | undefined {
  if (!day || day.cost <= 0) return undefined
  const spent = money(day.cost)
  if (budget && budget > 0) {
    const share = (day.cost / budget) * 100
    const tone: Tone | undefined = share >= 100 ? 'bad' : share >= 80 ? 'warn' : undefined
    return { key: 'today', priority: 58, tone, forms: [`today ${spent} of ${money(budget)}`, `today ${spent}`] }
  }
  return { key: 'today', priority: 58, tone: 'dim', forms: [`today ${spent}`] }
}

const BLOCKS = '▁▂▃▄▅▆▇█'

/** One block per value, scaled to the largest. */
export function spark(values: readonly number[]): string {
  const top = Math.max(0, ...values)
  return values.map(v => (top <= 0 || v <= 0 ? ' ' : BLOCKS[Math.min(7, Math.round((v / top) * 7))])).join('')
}

// ------------------------------------------------------------------ coach

const LOWER: Record<string, string> = { max: 'xhigh', xhigh: 'high', high: 'medium' }

/**
 * Advice for a usage window on pace to run out: how much slower the rest of
 * the window would have to go to last until it resets, and the one command
 * that usually gets there (a lower effort, else a lighter model), offered
 * for Tab to take. It changes nothing itself.
 */
export function coach(kind: 'five_hour' | 'seven_day', window: Window | undefined, now: number,
  effort?: string, offsetMinutes = 0): { text: string; suggest: string } | undefined {
  const state = pace(kind, window, now)
  const used = window?.used_percentage
  const resets = window?.resets_at
  if (state?.kind !== 'hot' || used === undefined || resets === undefined) return undefined
  const length = kind === 'five_hour' ? 5 * 3600 : 7 * 86400
  const rate = used / (now - (resets - length))
  const affordable = (100 - used) / (resets - now)
  const cut = Math.round((1 - affordable / rate) * 100)
  if (cut <= 0) return undefined
  const lower = effort ? LOWER[effort] : undefined
  const suggest = lower ? `/effort ${lower}` : '/model'
  const name = kind === 'five_hour' ? '5-hour' : 'Weekly'
  const at = (t: number) => clock(t, now, offsetMinutes)
  // Short enough for a toast's three lines.
  return {
    suggest,
    text: `${name} limit: out at ${at(state.eta)} at this pace, resets ${at(resets)}. To last, use ~${cut}% less per hour: Tab takes ${suggest}.`,
  }
}

// ------------------------------------------------------------------- card

export type CardInput = {
  model?: string
  elapsedSeconds?: number
  totals: Totals
  cost?: number
  cacheHit?: number
  fiveHour?: number
  agentsNow: number
  today?: Day
}

/** The share card's lines. No repository, branch, path or account. */
export function cardLines(c: CardInput): string[] {
  const t = c.totals
  const head = [c.model, c.elapsedSeconds !== undefined ? duration(c.elapsedSeconds) : undefined, plural(t.turns, 'turn')]
    .filter(Boolean).join(SEP)
  const work = [plural(t.tools, 'tool call'), t.agents ? plural(t.agents, 'agent') : undefined,
    t.failures ? plural(t.failures, 'failed call') : undefined].filter(Boolean).join(SEP)
  const cache = [c.cacheHit !== undefined ? `cache hit ${pct(c.cacheHit)}` : undefined,
    plural(t.compactions.length, 'compaction'), plural(t.colds, 'cold-cache rebuild')].filter(Boolean).join(SEP)
  const lines = ['glanceline · session card', head, work, cache]
  const money_ = [c.cost !== undefined ? `${money(c.cost)} at API prices` : undefined,
    t.peakContext ? `peak context ${pct(t.peakContext)}` : undefined,
    c.fiveHour !== undefined ? `5h window ${pct(c.fiveHour)}` : undefined].filter(Boolean).join(SEP)
  if (money_) lines.push(money_)
  if (c.today && c.today.sessions > 0) lines.push(`today: ${money(c.today.cost)} over ${plural(c.today.sessions, 'session')} on this machine`)
  return lines
}
