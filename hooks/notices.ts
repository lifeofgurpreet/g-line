// Notices: heads-ups from a command the person chose (`notices_command`). The
// command prints JSON; g-line shows each warn or urgent notice once as a
// toast, keeps a short marker on line 2 while any is active, and lists them
// with `/g-line notices`. The command's text is untrusted, so every string is
// stripped of escapes and control characters and cut to length (the same
// cleaning as Pulse's feed). g-line makes no network call of its own: whatever
// the command reads is its own doing.
//
// Pure: parsing, cadence and the line's segment.

import type { Segment } from './core'
import { clean } from './pulse'

export type NoticeLevel = 'info' | 'warn' | 'urgent'

export type Notice = {
  id: string
  level: NoticeLevel
  /** One line, at most 100 columns. */
  text: string
  detail?: string
  /** Unix seconds after which the notice is gone. */
  until?: number
}

export const NOTICE_TEXT_MAX = 100
export const NOTICE_DETAIL_MAX = 400
export const NOTICE_ID_MAX = 64
/** More than this many notices are ignored, so one command can't fill the pane. */
export const NOTICES_MAX = 20
/** The most output g-line reads from the command. */
export const NOTICES_OUTPUT_MAX = 64 * 1024
/** Defaults: how often the command runs, and how long before the same notice's toast repeats. */
export const NOTICES_INTERVAL_MINUTES = 5
export const NOTICES_REPEAT_HOURS = 6
/** An urgent notice may repeat this often, whatever the repeat setting says. */
export const URGENT_REPEAT_HOURS = 2

const LEVELS: readonly NoticeLevel[] = ['info', 'warn', 'urgent']

/**
 * The notices a command printed, or none: output that isn't the JSON, an
 * entry without an id or text, an unknown level and a notice whose `until` has
 * passed are left out. Text is cleaned; the same id twice keeps the first.
 */
export function parseNotices(raw: string, nowSeconds: number): Notice[] {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > NOTICES_OUTPUT_MAX) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  const list = data && typeof data === 'object' ? (data as { notices?: unknown }).notices : undefined
  if (!Array.isArray(list)) return []
  const out: Notice[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    if (out.length >= NOTICES_MAX) break
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const id = clean(e.id, NOTICE_ID_MAX)
    const text = clean(e.text, NOTICE_TEXT_MAX)
    if (!id || !text || seen.has(id)) continue
    const level = LEVELS.find(l => l === e.level)
    if (!level) continue
    let until: number | undefined
    if (typeof e.until === 'string') {
      const ms = Date.parse(e.until)
      if (Number.isFinite(ms)) until = Math.floor(ms / 1000)
    }
    if (until !== undefined && until <= nowSeconds) continue
    const detail = clean(e.detail, NOTICE_DETAIL_MAX)
    seen.add(id)
    out.push({ id, level, text, ...(detail ? { detail } : {}), ...(until !== undefined ? { until } : {}) })
  }
  return out
}

/** Notices still in force at `nowSeconds`. */
export function inForce(list: readonly Notice[], nowSeconds: number): Notice[] {
  return list.filter(n => n.until === undefined || n.until > nowSeconds)
}

/** The ones worth a marker and a toast: warn and urgent. */
export function loud(list: readonly Notice[]): Notice[] {
  return list.filter(n => n.level !== 'info')
}

/** When a notice's toast last showed, by id (ms). */
export type NoticeSeen = Record<string, number>

/**
 * The warn and urgent notices whose toast is due: never shown, or last shown
 * more than `repeatHours` ago (an urgent one at most `URGENT_REPEAT_HOURS`).
 */
export function toastsDue(list: readonly Notice[], seen: NoticeSeen, nowMs: number, repeatHours: number): Notice[] {
  return loud(list).filter(n => {
    const hours = n.level === 'urgent' ? Math.min(repeatHours, URGENT_REPEAT_HOURS) : repeatHours
    const last = seen[n.id]
    return last === undefined || nowMs - last >= hours * 3_600_000
  })
}

/** The toast's words: the notice's one line. */
export function toastText(n: Notice): string {
  return `${n.level === 'urgent' ? '⚠ ' : ''}${n.text}`
}

/**
 * Line 2's marker while a warn or urgent notice is in force: `⚠ 2 · /g-line
 * notices`. Kept at every width: where the row is too short for the command's
 * name it shrinks to `⚠ 2 notices` rather than go, so a phone still shows it. Red when any is urgent, amber otherwise.
 */
export function noticeSegment(list: readonly Notice[]): Segment | undefined {
  const active = loud(list)
  if (!active.length) return undefined
  const tone = active.some(n => n.level === 'urgent') ? 'bad' : 'warn'
  return { key: 'notices', priority: 92, tone, keep: 1, forms: [`⚠ ${active.length} · /g-line notices`, `⚠ ${active.length} notices`] }
}

/** The pane's and the command's rows, urgent first, then warn, then info; each notice's detail follows its line. */
export function noticeRows(list: readonly Notice[]): { text: string; level: NoticeLevel; detail?: string }[] {
  const order = { urgent: 0, warn: 1, info: 2 } as const
  return [...list].sort((a, b) => order[a.level] - order[b.level])
    .map(n => ({ text: n.text, level: n.level, ...(n.detail ? { detail: n.detail } : {}) }))
}
