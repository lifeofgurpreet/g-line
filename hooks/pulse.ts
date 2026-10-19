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

/** Only plain https links, short enough to be a link and not a payload. */
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 400) return undefined
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

/** The headline the spinner shows `elapsedMs` into a turn, cut to `room` columns, or nothing yet. */
export function tickerText(feed: PulseFeed | null | undefined, elapsedMs: number, room: number, nowMs?: number): string {
  if (!feed?.items.length || elapsedMs < PULSE_AFTER_MS || room < 24) return ''
  const item = feed.items[Math.floor((elapsedMs - PULSE_AFTER_MS) / PULSE_EVERY_MS) % feed.items.length]
  if (!item) return ''
  // A headline cut to a stub says nothing: drop the source before the title, and skip it if still too narrow.
  const lead = xLead(item, nowMs)
  if (lead && room - cells(lead) - 2 >= 24) return `${lead}: ${clean(item.title, room - cells(lead) - 2)}`
  if (lead) return clean(item.title, room)
  const tail = ` (${item.source})`
  if (room - cells(tail) >= 24) return `${clean(item.title, room - cells(tail))}${tail}`
  return clean(item.title, room)
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
