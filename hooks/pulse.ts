// Pulse: a few AI-dev headlines from g-line's own static feed, for the time a
// long turn keeps you waiting. Off unless turned on (`/g-line pulse`). When
// on, the mod fetches one static JSON file now and then; it sends nothing
// about you, and it never fetches while drawing.
//
// Pure: parsing and cleaning the feed. Feed text is untrusted, so every
// string is stripped of escapes and control characters and cut to length
// before it can reach the terminal.

import { width } from './core'
import type { PulseFeed, PulseItem } from '../types'

export type { PulseFeed, PulseItem }

export const PULSE_URL = 'https://raw.githubusercontent.com/lifeofgurpreet/g-line/pulse/pulse.json'
/** How long a fetched feed is used before the next fetch. */
export const PULSE_TTL_MS = 45 * 60_000
/** How long a turn runs before the spinner starts showing headlines. */
export const PULSE_AFTER_MS = 15_000
/** How long each headline stays on the spinner. */
export const PULSE_EVERY_MS = 8_000

// CSI and OSC escape sequences, then any C0/C1 control, then bidi and zero-width controls.
const ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g

/** Text safe to draw: no escapes or control characters, one line, at most `max` columns. */
export function clean(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(ESCAPES, '').replace(CONTROLS, ' ').replace(/\s+/g, ' ').trim()
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`
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

/** The feed's items, cleaned; anything malformed is left out. At most `limit`. */
export function parseFeed(raw: string, fetchedAt: number, limit = 8): PulseFeed | undefined {
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
    items.push({ title, url, source, at: clean(e.published_at, 32) || undefined })
    if (items.length >= limit) break
  }
  return { fetchedAt, generatedAt: clean(d.generated_at, 32) || undefined, items }
}

/** An X post leads with its author, and with its age once it is a day old: `𝕏 @claudeai · 3d`. Other items: nothing. */
export function xLead(item: PulseItem, nowMs?: number): string {
  if (!item.source.startsWith('𝕏 @')) return ''
  const at = item.at ? Date.parse(item.at) : Number.NaN
  const days = nowMs !== undefined && Number.isFinite(at) ? Math.floor((nowMs - at) / 86_400_000) : 0
  return days >= 1 ? `${item.source} · ${days}d` : item.source
}

/** The headline the spinner shows `elapsedMs` into a turn, cut to `room` columns, or nothing yet. */
export function tickerText(feed: PulseFeed | null | undefined, elapsedMs: number, room: number, nowMs?: number): string {
  if (!feed?.items.length || elapsedMs < PULSE_AFTER_MS || room < 24) return ''
  const item = feed.items[Math.floor((elapsedMs - PULSE_AFTER_MS) / PULSE_EVERY_MS) % feed.items.length]
  if (!item) return ''
  // A headline cut to a stub says nothing: drop the source before the title, and skip it if still too narrow.
  const lead = xLead(item, nowMs)
  if (lead && room - width(lead) - 2 >= 24) return `${lead}: ${clean(item.title, room - width(lead) - 2)}`
  if (lead) return clean(item.title, room)
  const tail = ` (${item.source})`
  if (room - width(tail) >= 24) return `${clean(item.title, room - width(tail))}${tail}`
  return clean(item.title, room)
}
