// Pulse: a few AI-dev headlines from g-line's own static feed, for the time a
// long turn keeps you waiting. Off unless turned on (`/g-line pulse`). When
// on, the mod fetches one static JSON file now and then; it sends nothing
// about you, and it never fetches while drawing.
//
// Pure: parsing and cleaning the feed. Feed text is untrusted, so every
// string is stripped of escapes and control characters and cut to length
// before it can reach the terminal.

import type { PulseFeed, PulseItem } from '../types'

export type { PulseFeed, PulseItem }

export const PULSE_URL = 'https://raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json'
/** How long a fetched feed is used before the next fetch. */
export const PULSE_TTL_MS = 45 * 60_000
/** How long a turn runs before the spinner starts showing headlines. */
export const PULSE_AFTER_MS = 15_000
/** How long each headline stays on the spinner and on Pulse's row. */
export const PULSE_EVERY_MS = 8_000

/** Pulse's 8-second beats per headline at each speed; paused never moves on. */
export const PULSE_BEATS = { normal: 1, slow: 5, paused: 0 } as const

/** Whether `mute` names the item's source: a case-insensitive match within it. */
export function muted(item: PulseItem, mute: readonly string[]): boolean {
  const source = item.source.toLowerCase()
  return mute.some(word => source.includes(word.toLowerCase()))
}
/** The longest text the reader shows for one item. */
export const TEXT_MAX = 600
/** How many items the reader shows at once. */
export const READER_PAGE = 5

// CSI and OSC escape sequences, then any C0/C1 control, then bidi and zero-width controls.
const ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g
// Variation selectors are dropped, so a symbol draws in its one-column text form.
const SELECTORS = /[\ufe00-\ufe0f]/g
// Feed text, unlike the mod's own, can hold emoji and East Asian wide characters (two columns) and combining marks (none).
const WIDE = /\p{Emoji_Presentation}|[\u1100-\u115f\u2e80-\u303e\u3041-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u
const ZERO = /[\p{Mn}\p{Me}]/u

const cell = (ch: string) => ZERO.test(ch) ? 0 : WIDE.test(ch) ? 2 : 1

/** Display columns of feed text. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += cell(ch)
  return n
}

/** Text safe to draw: no escapes or control characters, one line, at most `max` columns. */
export function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(ESCAPES, '').replace(CONTROLS, ' ').replace(SELECTORS, '').replace(/\s+/g, ' ').trim()
  if (cells(text) <= max) return text
  let kept = ''
  let used = 0
  for (const ch of text) {
    used += cell(ch)
    if (used > max - 1) break
    kept += ch
  }
  return `${kept.trimEnd()}…`
}

/**
 * Only plain https links, short enough to be a link and not a payload. A
 * publisher's gift link carries a token and can run past 400 characters;
 * Claude Code takes links up to 2048.
 */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1000) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return url.href
  } catch {
    return undefined
  }
}

const count = (value: unknown): number | undefined =>
  (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined)

/** The feed's items, cleaned; anything malformed is left out. At most `limit`. */
export function parseFeed(raw: string, fetchedAt: number, limit = 40): PulseFeed | undefined {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!data || typeof data !== 'object') return undefined
  const d = data as Record<string, unknown>
  if (d.schema !== 1 || !Array.isArray(d.items)) return undefined
  const items: PulseItem[] = []
  for (const entry of d.items) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const title = clean(e.title, 100)
    const url = safeUrl(e.url)
    const source = clean(e.source, 28)
    if (!title || !url || !source) continue
    const text = clean(e.text, TEXT_MAX)
    const likes = count(e.likes)
    const points = count(e.points)
    const author = clean(e.author_name, 40)
    const story = clean(e.story, 200)
    const via = clean(e.via, 28)
    const discussion = safeUrl(e.discussion)
    items.push({ title, url, source, at: clean(e.published_at, 32) || undefined,
      ...(text && text !== title ? { text } : {}), ...(likes !== undefined ? { likes } : {}), ...(author ? { author } : {}),
      ...(story ? { story } : {}), ...(via ? { via } : {}), ...(points !== undefined ? { points } : {}),
      ...(discussion ? { discussion } : {}) })
    if (items.length >= limit) break
  }
  return { fetchedAt, generatedAt: clean(d.generated_at, 32) || undefined, items }
}

/** An X post leads with its author and age: `𝕏 @claudeai · 40m`, `· 3h`, `· 2d`. Other items: nothing. */
export function xLead(item: PulseItem, nowMs?: number): string {
  if (!item.source.startsWith('𝕏 @')) return ''
  const at = item.at ? Date.parse(item.at) : Number.NaN
  if (nowMs === undefined || !Number.isFinite(at)) return item.source
  const minutes = Math.max(1, Math.floor((nowMs - at) / 60_000))
  const age = minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
  return `${item.source} · ${age}`
}

/** The spinner's headline for `item` `elapsedMs` into a turn, cut to `room` columns, or nothing yet. */
export function tickerText(item: PulseItem | undefined, elapsedMs: number, room: number, nowMs?: number): string {
  if (!item || elapsedMs < PULSE_AFTER_MS || room < 24) return ''
  // A headline cut to a stub says nothing: drop the source before the title, and skip it if still too narrow.
  const lead = xLead(item, nowMs)
  if (lead && room - cells(lead) - 2 >= 24) return `${lead}: ${clean(item.title, room - cells(lead) - 2)}`
  if (lead) return clean(item.title, room)
  const tail = ` (${item.source})`
  if (room - cells(tail) >= 24) return `${clean(item.title, room - cells(tail))}${tail}`
  return clean(item.title, room)
}

// ------------------------------------------------------------- the cycle
//
// The rules, as the README states them: the row moves every 8 s (slow: 40 s);
// headlines never shown come first, in the feed's order; a shown headline
// rests 30 minutes before it can come back, and shows at most 3 times a day;
// with every headline resting the row holds still; the same headline never
// shows twice in a row, a feed refresh included. Every session on the
// machine shares the count, so two sessions don't repeat each other.

/** How long a shown headline rests before it can come back. */
export const PULSE_REST_MS = 30 * 60_000
/** How many times a day a headline shows. */
export const PULSE_MAX_SHOWS = 3
/** How long a headline's count is kept. */
export const PULSE_FORGET_MS = 24 * 3_600_000

/** Per link: how many times it was shown, and when last (ms). */
export type Shown = Record<string, { n: number; at: number }>

/** The counts younger than a day; anything malformed is dropped. */
export function keptShown(raw: unknown, nowMs: number): Shown {
  const out: Shown = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [url, value] of Object.entries(raw as Record<string, unknown>)) {
    const r = value as { n?: unknown; at?: unknown } | null
    if (r && typeof r.n === 'number' && typeof r.at === 'number' && nowMs - r.at < PULSE_FORGET_MS) out[url] = { n: r.n, at: r.at }
  }
  return out
}

/** Two counts merged: the larger count and the later time of each link (another session may have shown it too). */
export function mergedShown(a: Shown, b: Shown): Shown {
  const out: Shown = { ...a }
  for (const [url, s] of Object.entries(b)) {
    const was = out[url]
    out[url] = was ? { n: Math.max(was.n, s.n), at: Math.max(was.at, s.at) } : s
  }
  return out
}

/**
 * The headline to move to after `current`, or nothing to hold still: one
 * never shown first, in the feed's order; else the one shown longest ago
 * that has rested and has shows left. Never `current` itself.
 */
export function pickNext(items: readonly PulseItem[], shown: Shown, current: string | null | undefined, nowMs: number): PulseItem | undefined {
  const others = items.filter(item => item.url !== current)
  const fresh = others.find(item => !shown[item.url])
  if (fresh) return fresh
  return others
    .filter(item => {
      const s = shown[item.url]
      return s !== undefined && s.n < PULSE_MAX_SHOWS && nowMs - s.at >= PULSE_REST_MS
    })
    .sort((a, b) => (shown[a.url]?.at ?? 0) - (shown[b.url]?.at ?? 0))[0]
}

/**
 * The headline shown now: `current` while the feed still has it; else the
 * next by the rules; else, every one resting, the one shown longest ago.
 */
export function itemNow(items: readonly PulseItem[], shown: Shown, current: string | null | undefined, nowMs: number): PulseItem | undefined {
  const held = items.find(item => item.url === current)
  if (held) return held
  return pickNext(items, shown, current, nowMs)
    ?? [...items].sort((a, b) => (shown[a.url]?.at ?? 0) - (shown[b.url]?.at ?? 0))[0]
}

/** `shown` with one more show of `url` at `nowMs`. */
export function withShow(shown: Shown, url: string, nowMs: number): Shown {
  return { ...shown, [url]: { n: (shown[url]?.n ?? 0) + 1, at: nowMs } }
}

// ------------------------------------------------------------- the links

/** The variables Claude Code decides links by. */
export type TermEnv = Partial<Record<'FORCE_HYPERLINK' | 'NETLIFY' | 'CI' | 'TEAMCITY_VERSION' | 'WT_SESSION' | 'TERM_PROGRAM'
  | 'TERM_PROGRAM_VERSION' | 'VTE_VERSION' | 'TERM' | 'TERMINAL_EMULATOR' | 'TMUX' | 'LC_TERMINAL', string>>

function version(text: string | undefined): { major: number; minor: number } {
  if (text && /^\d{3,4}$/.test(text)) {
    const m = /(\d{1,2})(\d{2})/.exec(text)
    return { major: 0, minor: Number(m?.[1]) }
  }
  const [major = Number.NaN, minor = Number.NaN] = (text ?? '').split('.').map(part => Number.parseInt(part, 10))
  return { major, minor }
}

const LINK_TERMINALS = ['ghostty', 'Hyper', 'kitty', 'alacritty', 'iTerm.app', 'iTerm2', 'WarpTerminal']

/**
 * Whether Claude Code draws a `Link` as an OSC 8 link, by its own rule
 * (2.1.304): FORCE_HYPERLINK first, then the terminals it recognises. Where
 * it doesn't, it prints the link's whole address after the text, so Pulse's
 * row draws its headline as plain text there. A terminal Claude Code doesn't
 * recognise (herdr, Zellij, a session reached over SSH) gets links with
 * `FORCE_HYPERLINK=1` set where Claude Code starts.
 */
export function linksDrawn(env: TermEnv): boolean {
  const force = env.FORCE_HYPERLINK
  if (force) return !(force.length > 0 && Number.parseInt(force, 10) === 0)
  const program = env.TERM_PROGRAM
  if (env.NETLIFY || env.WT_SESSION !== undefined) return true
  const ci = !!env.CI || !!env.TEAMCITY_VERSION
  if (!ci && program === 'WezTerm' && version(env.TERM_PROGRAM_VERSION).major >= 20200620) return true
  if (!ci && program === 'vscode') {
    const v = version(env.TERM_PROGRAM_VERSION)
    if (v.major > 1 || (v.major === 1 && v.minor >= 72)) return true
  }
  if (!ci && env.VTE_VERSION && env.VTE_VERSION !== '0.50.0') {
    const v = version(env.VTE_VERSION)
    if (v.major > 0 || v.minor >= 50) return true
  }
  if (!ci && env.TERM === 'alacritty') return true
  if (program && LINK_TERMINALS.includes(program)) return true
  if (env.TERMINAL_EMULATOR === 'JetBrains-JediTerm') return true
  if (program === 'tmux') {
    const v = version(env.TERM_PROGRAM_VERSION)
    if (v.major > 3 || (v.major === 3 && v.minor >= 4)) return true
  }
  if (env.LC_TERMINAL && LINK_TERMINALS.includes(env.LC_TERMINAL)) return true
  return env.TERM?.includes('kitty') === true
}

/**
 * Whether a browser can open for the person on this machine: never over
 * SSH, and on Linux only with a display. A multiplexer's server started
 * detached (herdr, tmux) carries no SSH variables, so there the display decides.
 */
export function opensHere(o: { os: string; ssh: boolean; display: boolean }): boolean {
  if (o.ssh) return false
  return o.os === 'Darwin' || o.display
}

/** An item's age: `40m`, `3h`, `2d`; nothing when the feed gave no time. */
export function ageOf(item: PulseItem, nowMs: number): string {
  const at = item.at ? Date.parse(item.at) : Number.NaN
  if (!Number.isFinite(at)) return ''
  const minutes = Math.max(1, Math.floor((nowMs - at) / 60_000))
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}

/** `1.2k` likes and the like: a count a glance can take in. */
export function countOf(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return n < 1_000_000 ? `${Math.round(n / 1000)}k` : `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

/**
 * Pulse's row under the prompt: who, how long ago, the headline, and a dim
 * pointer to the reader when there is room. Each part is plain text: the
 * headline is drawn as a link by the caller. Nothing when too narrow.
 */
export function pulseRow(item: PulseItem | undefined, room: number, nowMs: number):
  { lead: string; title: string; tail: string } | undefined {
  if (!item || room < 30) return undefined
  const age = ageOf(item, nowMs)
  const lead = `${item.source}${age ? ` · ${age}` : ''}`
  const tailText = ' · /g-line news'
  const tail = room - cells(lead) - 2 - cells(tailText) >= 40 ? tailText : ''
  const titleRoom = room - cells(lead) - 2 - cells(tail)
  if (titleRoom < 24) return { lead: '', title: clean(item.title, room), tail: '' }
  return { lead, title: clean(item.title, titleRoom), tail }
}

/** The items the reader shows around the selected one: `[start, end)`, at most `size`. */
export function pageOf(count: number, selected: number, size = READER_PAGE): [number, number] {
  if (count <= size) return [0, count]
  const start = Math.min(Math.max(0, selected - Math.floor(size / 2)), count - size)
  return [start, start + size]
}
