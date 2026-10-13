// The one line glanceline adds under the prompt: every segment of the layout,
// then an optional account, fitted to the room left at the end of Claude
// Code's own hint line. Pure, like core.ts, so tests can call it directly.

import { SEP, fit, segments, width } from './core'
import type { Options, Payload, Placed, Segment } from './core'

/**
 * Columns the engine's permission-mode label takes before the hint when a
 * mode is on (`⏵⏵ bypass permissions on `, the widest), the hint then reading
 * `(shift+tab to cycle)`.
 */
export const MODE_LABEL = 26

/** The hint line's two-column indent, and the three columns the engine keeps free at its right end. */
const EDGES = 5

/**
 * The line an `account_command` printed, as one short segment:
 * `account you@example.com (via CAAM)` reads `you@example.com`.
 */
export function accountSegment(line?: string | null): Segment | undefined {
  const text = line?.trim()
  if (!text) return undefined
  const short = text.replace(/^account\s+/i, '').replace(/\s*\([^()]*\)$/, '').trim()
  return { key: 'account', priority: 65, tone: 'dim', forms: [short || text] }
}

/**
 * Columns left for glanceline after the engine's hint (which it joins to the
 * tail with ` · `), or undefined when the surface has not measured.
 */
export function tailRoom(columns: number | undefined, hint: string): number | undefined {
  if (columns === undefined) return undefined
  const mode = /shift\+tab/i.test(hint) ? MODE_LABEL : 0
  return columns - EDGES - mode - width(hint) - SEP.length
}

/**
 * Every segment on one line, the account last, fitted to `room`: segments
 * narrow together and the least important go first. Empty under four
 * columns, where the engine would leave the tail out anyway.
 */
export function inline(p: Payload, o: Options, account?: string | null, room?: number): Placed[] {
  const items = segments(p, o).flat()
  const extra = accountSegment(account)
  if (extra) items.push(extra)
  if (!items.length || (room !== undefined && room < 4)) return []
  return fit(items, room)
}

export function joined(parts: Placed[]): string {
  return parts.map(part => part.text).join(SEP)
}
