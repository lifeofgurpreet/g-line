// Settings: one table every surface reads. The defaults, merging a layer
// (a config file, /config, a choice made in the pane), the pane's toggles,
// `/g-line set` and `/g-line settings` all come from SETTINGS below, so a
// setting added here has a toggle, a command name and an origin at once.
//
// Pure: no `$`. The layers are read in register.tsx, lowest first:
// defaults, the plugin's config.json, ~/.config/glanceline/config.json (0.4),
// ~/.config/g-line/config.json, /config, then the pane. The highest layer
// that names a setting is where its value comes from.

import { num, zoneOffset } from './core'
import type { Preset } from './core'
import { receiptFields } from './extras'
import type { ReceiptSpec } from './extras'
import { NO_GUARD, parseGuard, seconds } from './guard'
import type { GuardConfig } from './guard'

export type Notify = { cache: boolean; reset: boolean; longTurn: boolean; agents: boolean }

export type PulseSpeed = 'normal' | 'slow' | 'paused'

export type Config = {
  /** 2: line 1 at the end of the hint line, line 2 under it; 1: the hint line only; 0: receipts, spinner and heads-ups, no footer. */
  lines: 0 | 1 | 2
  /** Headlines from g-line's feed on long turns' spinner and in the pane; fetches one static file. */
  pulse: boolean
  /** How often Pulse moves to the next headline. */
  pulseSpeed: PulseSpeed
  /** Sources Pulse skips, matched case-insensitively within an item's source: `𝕏` skips every post on X. */
  pulseMute: string[]
  /** Shorten Claude Code's standing hints: `(shift+tab to cycle)` to `⇧⇥`, `? for shortcuts` to `?`. */
  shortHints: boolean
  /** The branch on line 2 (two lines; one line names `git` in `segments`). */
  git: boolean
  preset: Preset
  segments?: string
  icons: 'none' | 'nerd'
  toasts: boolean
  cacheTtl: 'auto' | '5m' | '1h'
  accountCommand?: string[]
  /** A command that prints the account's usage as JSON (another machine's spending); only with `accountCommand`. */
  usageCommand?: string[]
  notify: Notify
  longTurnSeconds: number
  resetThreshold: number
  receipt: ReceiptSpec
  spinner: boolean
  footerLabels: boolean
  coach: boolean
  /** Give Claude the `status` tool to read these figures when asked (off by default). */
  claudeReads: boolean
  toolStreak: number
  budget?: number
  exportState: boolean
  /** The guard's rules and keep-warm (config.json `guard`); none by default, so it does nothing. */
  guard: GuardConfig
  /** The other g-line sessions on this machine: `2 others · 1 waiting` on line 2, and the list in the pane. */
  roster: boolean
  /** The person's IANA time zone for every time g-line shows; the machine's own when unset (`auto`). */
  tz?: string
}

export const DEFAULTS: Config = {
  lines: 2, pulse: false, pulseSpeed: 'normal', pulseMute: [], shortHints: true, git: false, preset: 'default', icons: 'none', toasts: true, cacheTtl: 'auto',
  notify: { cache: true, reset: true, longTurn: false, agents: false },
  longTurnSeconds: 60, resetThreshold: 80, receipt: 'adaptive', spinner: true, footerLabels: true,
  coach: false, claudeReads: false, toolStreak: 3, exportState: false, guard: NO_GUARD, roster: true,
}

/** One layer over `base`: config.json's snake_case keys; anything malformed is ignored. */
export function merge(base: Config, raw: unknown): Config {
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const next = { ...base, notify: { ...base.notify } }
  if ([0, 1, 2, '0', '1', '2'].includes(r.lines as number)) next.lines = Number(r.lines) as 0 | 1 | 2
  if (r.lines === 'receipts') next.lines = 0
  if (typeof r.pulse === 'boolean') next.pulse = r.pulse
  if (r.pulse_speed === 'normal' || r.pulse_speed === 'slow' || r.pulse_speed === 'paused') next.pulseSpeed = r.pulse_speed
  if (Array.isArray(r.pulse_mute)) {
    next.pulseMute = r.pulse_mute.filter((word): word is string => typeof word === 'string' && word.trim() !== '')
      .map(word => word.trim()).slice(0, 100)
  }
  if (typeof r.git === 'boolean') next.git = r.git
  if (typeof r.short_hints === 'boolean') next.shortHints = r.short_hints
  if (r.preset === 'minimal' || r.preset === 'default' || r.preset === 'full') next.preset = r.preset
  // A custom layout is one line's: naming segments picks the one-line layout.
  if (typeof r.segments === 'string' && r.segments.trim()) {
    next.segments = r.segments
    if (r.lines === undefined) next.lines = 1
  }
  if (r.icons === 'none' || r.icons === 'nerd') next.icons = r.icons
  if (typeof r.toasts === 'boolean') next.toasts = r.toasts
  if (r.cache_ttl === '5m' || r.cache_ttl === '1h' || r.cache_ttl === 'auto') next.cacheTtl = r.cache_ttl
  const command = r.account_command
  if (Array.isArray(command) && command.length && command.every(word => typeof word === 'string')) {
    next.accountCommand = command as string[]
  }
  const usage = r.usage_command
  if (Array.isArray(usage) && usage.length && usage.every(word => typeof word === 'string')) {
    next.usageCommand = usage as string[]
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
  if (typeof r.claude_reads === 'boolean') next.claudeReads = r.claude_reads
  const streak = num(r.tool_streak)
  if (streak !== undefined && streak >= 0) next.toolStreak = Math.floor(streak)
  const budget = num(r.today_budget)
  if (budget !== undefined && budget > 0) next.budget = budget
  if (typeof r.export_state === 'boolean') next.exportState = r.export_state
  if (typeof r.roster === 'boolean') next.roster = r.roster
  if (r.tz === 'auto' || r.tz === null) delete next.tz
  else if (typeof r.tz === 'string' && r.tz.trim() && zoneOffset(r.tz.trim(), 0) !== undefined) next.tz = r.tz.trim()
  // `true`/`false` (from `/g-line guard on|off`) switches the rules the files wrote; an object replaces them.
  if (typeof r.guard === 'boolean') next.guard = { ...base.guard, on: r.guard }
  else if (r.guard && typeof r.guard === 'object') next.guard = parseGuard(r.guard)
  return next
}

// ------------------------------------------------------------- the table

export type Group = 'Show' | 'Heads-ups' | 'Extras'

type Common = {
  /** The config.json key; `notify.cache` is `{ "notify": { "cache": … } }`. */
  key: string
  /** Other names `/g-line set` takes. */
  aliases: readonly string[]
  label: string
  group: Group
  /** The pane's key for it: unique among the settings view's buttons. */
  hotkey: string
  help: string
}

/** On or off. */
export type Toggle = Common & { kind: 'toggle'; get: (c: Config) => boolean }

/** One of a few named values, cycled in the pane. */
export type Choice = Common & { kind: 'choice'; options: readonly string[]; get: (c: Config) => string; words?: Readonly<Record<string, string>> }

export type Setting = Toggle | Choice

const receiptName = (c: Config): string => {
  if (c.receipt === 'adaptive') return 'adaptive'
  if (!c.receipt.length) return 'off'
  const short = receiptFields('short')
  const full = receiptFields('full')
  const same = (a: ReceiptSpec, b: ReceiptSpec) => Array.isArray(a) && Array.isArray(b) && a.join() === b.join()
  return same(c.receipt, short) ? 'short' : same(c.receipt, full) ? 'full' : 'custom'
}

const toggle = (key: string, label: string, group: Group, hotkey: string, get: (c: Config) => boolean, help: string,
  aliases: readonly string[] = []): Toggle => ({ kind: 'toggle', key, label, group, hotkey, get, help, aliases })

export const SETTINGS: readonly Setting[] = [
  { kind: 'choice', key: 'lines', aliases: ['layout'], label: 'Layout', group: 'Show', hotkey: 'l',
    options: ['2', '1', 'receipts'], get: c => (c.lines === 0 ? 'receipts' : String(c.lines)),
    words: { 2: 'two lines', 1: 'one line', receipts: 'receipts only' },
    help: '2: the hint line plus one row under it; 1: the hint line only; receipts: no footer' },
  { kind: 'choice', key: 'receipt', aliases: ['receipts'], label: 'Receipt', group: 'Show', hotkey: 'r',
    options: ['adaptive', 'short', 'full', 'off'], get: receiptName,
    help: 'what each turn\'s closing line adds' },
  toggle('spinner', 'Spinner extras', 'Show', 's', c => c.spinner, 'the running turn\'s cost and tools on the spinner'),
  toggle('footer_labels', 'Footer labels', 'Show', 'f', c => c.footerLabels, 'agents and compaction in the footer (one-line layout)', ['footer']),
  toggle('short_hints', 'Short hints', 'Show', 'h', c => c.shortHints, '`(shift+tab to cycle)` drawn as `⇧⇥`', ['hints']),
  toggle('git', 'Git branch', 'Show', 'g', c => c.git, 'the branch on line 2', ['branch', 'git_branch']),
  toggle('roster', 'Other sessions', 'Show', 'b', c => c.roster, 'other g-line sessions on this machine on line 2, and which wait on you', ['others', 'sessions']),
  toggle('toasts', 'Toasts', 'Heads-ups', 't', c => c.toasts, 'heads-ups as toasts in the terminal'),
  toggle('notify.cache', 'Cold cache', 'Heads-ups', 'k', c => c.notify.cache, 'a notification before the prompt cache goes cold', ['cache', 'cold_cache']),
  toggle('notify.reset', 'Window reset', 'Heads-ups', 'w', c => c.notify.reset, 'a notification when a usage window resets', ['reset', 'window_reset']),
  toggle('notify.long_turn', 'Long turn', 'Heads-ups', 'u', c => c.notify.longTurn, 'a notification when a long turn ends', ['long_turn']),
  toggle('notify.agents', 'Agents', 'Heads-ups', 'a', c => c.notify.agents, 'a notification when a background agent ends', ['agents']),
  toggle('pulse', 'Pulse', 'Extras', 'p', c => c.pulse, 'AI dev headlines and posts on X; fetches one static file every 45 minutes'),
  { kind: 'choice', key: 'pulse_speed', aliases: ['speed', 'rotation'], label: 'Pulse speed', group: 'Extras', hotkey: 'v',
    options: ['normal', 'slow', 'paused'], get: c => c.pulseSpeed,
    words: { normal: 'every 8 s', slow: 'every 40 s', paused: 'paused' },
    help: 'how often Pulse moves to the next headline; paused keeps one until you page in /g-line news' },
  toggle('coach', 'Coach', 'Extras', 'o', c => c.coach, 'offers /effort or /compact for Tab to take; never changes anything'),
  toggle('claude_reads', 'Claude reads', 'Extras', 'x', c => c.claudeReads, 'gives Claude a read-only `status` tool for these figures', ['status', 'status_tool']),
  toggle('export_state', 'Export state', 'Extras', 'e', c => c.exportState, 'writes the figures as JSON for tmux and other bars', ['export']),
]

export const GROUPS: readonly Group[] = ['Show', 'Heads-ups', 'Extras']

const normal = (name: string) => name.trim().toLowerCase().replace(/[-\s]+/g, '_')

/** The setting a name means: its key, an alias, or its label. */
export function findSetting(name: string): Setting | undefined {
  const n = normal(name)
  return SETTINGS.find(s => normal(s.key) === n || s.aliases.includes(n) || normal(s.label) === n)
}

/** The value in words, for the pane and toasts: `on`, `two lines`. */
export function said(setting: Setting, c: Config): string {
  const value = shown(setting, c)
  return setting.kind === 'choice' ? setting.words?.[value] ?? value : value
}

/** The value as config.json spells it: `on`/`off` or the choice's name. */
export function shown(setting: Setting, c: Config): string {
  return setting.kind === 'toggle' ? (setting.get(c) ? 'on' : 'off') : setting.get(c)
}

/** What a layer gets to say `setting` is `value`: `{ pulse: true }`, `{ notify: { cache: false } }`. */
export function patchOf(setting: Setting, value: boolean | string): Record<string, unknown> {
  if (setting.key.startsWith('notify.')) return { notify: { [setting.key.slice('notify.'.length)]: value } }
  if (setting.key === 'lines') return { lines: value === '2' || value === '1' ? Number(value) : value }
  return { [setting.key]: value }
}

/** A saved layer with a patch laid over it; `notify` is merged field by field. */
export function withPatch(saved: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...saved, ...patch }
  if (patch.notify && typeof patch.notify === 'object') {
    const was = saved.notify
    const before = typeof was === 'boolean'
      ? { cache: was, reset: was, ...(was ? {} : { long_turn: false, agents: false }) }
      : was && typeof was === 'object' ? was as Record<string, unknown> : {}
    next.notify = { ...before, ...(patch.notify as Record<string, unknown>) }
  }
  return next
}

/** A saved layer without `setting`: what the layers beneath it then decide. */
export function withoutSetting(saved: Record<string, unknown>, setting: Setting): Record<string, unknown> {
  const next = { ...saved }
  if (setting.key.startsWith('notify.')) {
    const sub = setting.key.slice('notify.'.length)
    const was = saved.notify
    if (typeof was === 'boolean') next.notify = (withPatch({ notify: was }, { notify: {} })).notify
    if (next.notify && typeof next.notify === 'object') {
      const rest = { ...(next.notify as Record<string, unknown>) }
      delete rest[sub]
      if (Object.keys(rest).length) next.notify = rest
      else delete next.notify
    }
    return next
  }
  delete next[setting.key]
  return next
}

/** Whether a layer names `setting`. */
export function names(raw: unknown, setting: Setting): boolean {
  if (!raw || typeof raw !== 'object') return false
  const r = raw as Record<string, unknown>
  if (setting.key.startsWith('notify.')) {
    if (typeof r.notify === 'boolean') return true
    return !!r.notify && typeof r.notify === 'object' && typeof (r.notify as Record<string, unknown>)[setting.key.slice(7)] === 'boolean'
  }
  if (setting.key === 'lines') return r.lines !== undefined || (typeof r.segments === 'string' && !!r.segments.trim())
  return r[setting.key] !== undefined
}

export type Layer = { name: string; raw: unknown }

/** Where a setting's value comes from: the highest layer that names it, else `default`. */
export function originOf(setting: Setting, layers: readonly Layer[]): string {
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer && names(layer.raw, setting)) return layer.name
  }
  return 'default'
}

/** Whether the value differs from what a fresh install shows. */
export function changed(setting: Setting, c: Config): boolean {
  return shown(setting, c) !== shown(setting, DEFAULTS)
}

/** The next value a press in the pane moves to. */
export function nextValue(setting: Setting, c: Config): boolean | string {
  if (setting.kind === 'toggle') return !setting.get(c)
  const at = setting.options.indexOf(setting.get(c))
  return setting.options[(at + 1) % setting.options.length] ?? setting.options[0] ?? ''
}

// --------------------------------------------------------------- command

export type Command =
  | { kind: 'pane' }
  | { kind: 'card' }
  | { kind: 'settings' }
  | { kind: 'news' }
  | { kind: 'open' }
  | { kind: 'show' }
  | { kind: 'hide' }
  | { kind: 'set'; setting: Setting; value: boolean | string | 'toggle' }
  | { kind: 'all'; value: boolean }
  | { kind: 'reset'; setting?: Setting }
  | { kind: 'guard'; action: 'status' | 'once' | 'resume' | 'on' | 'off' | 'cancel' | 'why' | 'on here' | 'off here' }
  | { kind: 'guard'; action: 'pause'; seconds: number }
  | { kind: 'guard'; action: 'simulate'; window: '5h' | 'week'; used: number }
  | { kind: 'guard'; action: 'simulate'; window?: undefined; used?: undefined }
  | { kind: 'error'; text: string }

const ON = ['on', 'true', 'yes', '1', 'enable', 'enabled']
const OFF = ['off', 'false', 'no', '0', 'disable', 'disabled']

const unknownName = (name: string) => ({
  kind: 'error' as const,
  text: `g-line has no setting "${name}". /g-line settings lists them: ${SETTINGS.map(s => s.key).join(', ')}.`,
})

/** What `/g-line <args>` asks for. */
export function parseCommand(args: string): Command {
  const words = args.trim().split(/\s+/).filter(Boolean).map(w => w.toLowerCase())
  const [verb = '', ...rest] = words
  if (verb === '' || verb === 'details') return { kind: 'pane' }
  if (verb === 'card') return { kind: 'card' }
  if (verb === 'settings' || verb === 'config' || verb === 'list') return { kind: 'settings' }
  if ((verb === 'news' || verb === 'read' || verb === 'reader') && !rest.length) return { kind: 'news' }
  if (verb === 'open' && !rest.length) return { kind: 'open' }
  if (verb === 'on' && !rest.length) return { kind: 'show' }
  if (verb === 'guard') return guardCommand(rest)
  if (verb === 'off' && !rest.length) return { kind: 'hide' }
  if (verb === 'reset') {
    if (!rest.length) return { kind: 'reset' }
    const setting = findSetting(rest.join('_'))
    return setting ? { kind: 'reset', setting } : unknownName(rest.join(' '))
  }
  // `/g-line set pulse on`, `/g-line toggle pulse`, and the bare `/g-line pulse [on|off]` of 0.5.
  const named = verb === 'set' || verb === 'toggle' ? rest : words
  if (!named.length) return { kind: 'error', text: 'Name a setting: /g-line set pulse on. /g-line settings lists them.' }
  const last = named[named.length - 1] ?? ''
  const hasValue = named.length > 1 && verb !== 'toggle'
  const name = hasValue ? named.slice(0, -1).join('_') : named.join('_')
  const raw = hasValue ? last : 'toggle'
  if (name === 'all' || name === 'everything') {
    if (ON.includes(raw)) return { kind: 'all', value: true }
    if (OFF.includes(raw)) return { kind: 'all', value: false }
    return { kind: 'error', text: '/g-line set all on, or /g-line set all off.' }
  }
  const setting = findSetting(name)
  if (!setting) return unknownName(name.replace(/_/g, ' '))
  if (raw === 'toggle') return { kind: 'set', setting, value: 'toggle' }
  if (setting.kind === 'toggle') {
    if (ON.includes(raw)) return { kind: 'set', setting, value: true }
    if (OFF.includes(raw)) return { kind: 'set', setting, value: false }
    return { kind: 'error', text: `${setting.key} is on or off.` }
  }
  const choice = raw === 'two' ? '2' : raw === 'one' ? '1' : raw
  if (setting.options.includes(choice)) return { kind: 'set', setting, value: choice }
  return { kind: 'error', text: `${setting.key} is one of ${setting.options.join(', ')}.` }
}

/** `/g-line guard [status|why|once|pause [30m]|resume|on|off|off here|on here]`. */
function guardCommand(rest: string[]): Command {
  const [action = 'status', ...more] = rest
  if (action === 'pause') {
    const s = more.length ? seconds(more.join('')) : 3600
    if (s === undefined || s <= 0 || s > 24 * 3600) return { kind: 'error', text: '/g-line guard pause takes a time up to a day, such as 30m or 2h; an hour if none.' }
    return { kind: 'guard', action: 'pause', seconds: s }
  }
  if (action === 'simulate' || action === 'sim') {
    if (more.length === 1 && (more[0] === 'off' || more[0] === 'stop')) return { kind: 'guard', action: 'simulate' }
    const [win = '', pct = ''] = more
    const window = win === '5h' || win === 'five' ? '5h' : win === 'week' || win === 'wk' || win === '7d' ? 'week' : undefined
    const used = Number(pct.replace(/%$/, ''))
    if (!window || more.length !== 2 || !Number.isFinite(used) || used < 0 || used > 100) {
      return { kind: 'error', text: '/g-line guard simulate 5h 96 (or week 90): the guard acts as if that much of the window were used, for 15 minutes. /g-line guard simulate off ends it.' }
    }
    return { kind: 'guard', action: 'simulate', window, used }
  }
  // `off here`: this session alone, so the person's own session is free while agents on the machine stay guarded.
  if ((action === 'off' || action === 'on') && more.length === 1 && (more[0] === 'here' || more[0] === 'me')) {
    return { kind: 'guard', action: action === 'off' ? 'off here' : 'on here' }
  }
  if (more.length === 0 && (action === 'status' || action === 'once' || action === 'resume' || action === 'on' || action === 'off' || action === 'cancel' || action === 'why')) {
    return { kind: 'guard', action }
  }
  return { kind: 'error', text: '/g-line guard, then why, once, off here, on here, pause [30m], resume, simulate 5h 96, cancel, on or off.' }
}
