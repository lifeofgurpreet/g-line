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
  return readNotices(raw, nowSeconds).notices ?? []
}

/** Why a run gave no list: said in the pane's header. */
export type NoticesFailure = 'not found' | 'timed out' | 'not JSON' | `exit code ${number}` | 'did not run'

/** The notices a run printed, or the reason it gave none. Empty `notices` is a good, empty list. */
export function readNotices(raw: string, nowSeconds: number): { notices?: Notice[]; failure?: NoticesFailure } {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > NOTICES_OUTPUT_MAX) return { failure: 'not JSON' }
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { failure: 'not JSON' }
  }
  const list = data && typeof data === 'object' ? (data as { notices?: unknown }).notices : undefined
  if (!Array.isArray(list)) return { failure: 'not JSON' }
  return { notices: listOf(list, nowSeconds) }
}

/** What a finished or failed run says about itself: the failure, or undefined for a clean exit. */
export function runFailure(run: unknown): NoticesFailure | undefined {
  if (run instanceof Error || (run && typeof run === 'object' && !('exitCode' in run) && 'message' in run)) {
    const text = String((run as { message?: unknown }).message ?? '') + String((run as { code?: unknown }).code ?? '')
    if (/ENOENT|not found|no such file/i.test(text)) return 'not found'
    if (/time|ETIMEDOUT|abort/i.test(text)) return 'timed out'
    return 'did not run'
  }
  const r = (run ?? {}) as { exitCode?: unknown; timedOut?: unknown; signal?: unknown }
  if (r.timedOut) return 'timed out'
  if (r.exitCode === 0) return undefined
  if (r.exitCode === 127) return 'not found'
  if (typeof r.exitCode === 'number') return `exit code ${r.exitCode}`
  return r.signal ? 'timed out' : 'did not run'
}

/** A failed run keeps the last good list for this many intervals. */
export const NOTICES_KEEP_INTERVALS = 2

/** Whether the last good list, read at `goodAt` (ms), still stands at `nowMs` after a failed run. */
export function keepsLast(goodAt: number, nowMs: number, intervalMinutes: number): boolean {
  return goodAt > 0 && nowMs - goodAt <= NOTICES_KEEP_INTERVALS * intervalMinutes * 60_000
}

function listOf(list: unknown[], nowSeconds: number): Notice[] {
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
    // An ISO string or a finite number of Unix seconds; any other `until` makes the notice unusable.
    let until: number | undefined
    if (e.until !== undefined && e.until !== null) {
      if (typeof e.until === 'number' && Number.isFinite(e.until)) until = Math.floor(e.until)
      else if (typeof e.until === 'string' && Number.isFinite(Date.parse(e.until))) until = Math.floor(Date.parse(e.until) / 1000)
      else continue
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

/**
 * One toast per run: the most severe due notice (urgent before warn, then the
 * command's order) and, when others are due, `+N more · /g-line notices`.
 */
export function toastFor(due: readonly Notice[]): string | undefined {
  const top = [...due].sort((a, b) => Number(b.level === 'urgent') - Number(a.level === 'urgent'))[0]
  if (!top) return undefined
  return due.length > 1 ? `${toastText(top)} +${due.length - 1} more · /g-line notices` : toastText(top)
}

/** The toast's words: the notice's one line. */
export function toastText(n: Notice): string {
  return `${n.level === 'urgent' ? '⚠ ' : ''}${n.text}`
}

/**
 * Line 2's marker while a warn or urgent notice is in force: `⚠ 2 · /g-line
 * notices`. Kept at every width: where the row is too short for the command's
 * name it shrinks to `⚠ 2 notices`, then `⚠ 2`, rather than go, so a phone still shows it. Its priority sits below the windows' timings and clock times, which it never pushes off. Red when any is urgent, amber otherwise.
 */
export function noticeSegment(list: readonly Notice[]): Segment | undefined {
  const active = loud(list)
  if (!active.length) return undefined
  const tone = active.some(n => n.level === 'urgent') ? 'bad' : 'warn'
  return { key: 'notices', priority: 60, tone, keep: 2, forms: [`⚠ ${active.length} · /g-line notices`, `⚠ ${active.length} notices`, `⚠ ${active.length}`] }
}

/** The pane's and the command's rows, urgent first, then warn, then info; each notice's detail follows its line. */
export function noticeRows(list: readonly Notice[]): { text: string; level: NoticeLevel; detail?: string }[] {
  const order = { urgent: 0, warn: 1, info: 2 } as const
  return [...list].sort((a, b) => order[a.level] - order[b.level])
    .map(n => ({ text: n.text, level: n.level, ...(n.detail ? { detail: n.detail } : {}) }))
}
