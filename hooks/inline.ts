// The one line glanceline adds under the prompt: every segment of the layout,
// then an optional account, fitted to the room left at the end of Claude
// Code's own hint line. Pure, like core.ts, so tests can call it directly.

import { SEP, fit, layoutKeys, segments, width } from './core'
import type { Options, Payload, Placed, Segment } from './core'

/**
 * Columns the engine's permission-mode label takes before the hint when a
 * mode is on (`⏵⏵ bypass permissions on `, the widest), the hint then reading
 * `(shift+tab to cycle)`.
 */
export const MODE_LABEL = 26

/**
 * Columns of the label a quieter mode draws before the hint (`⏸ manual mode
 * on · `). The hint the mod is handed leaves it out, and it stays while you
 * type, so these columns are always kept free.
 */
export const QUIET_MODE_LABEL = 19

/** The hint line's two-column indent, and the three columns the engine keeps free at its right end. */
const EDGES = 5

/**
 * The line an `account_command` printed, as one short segment:
 * `account you@example.com (via my-accounts)` reads `you@example.com`.
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
export function tailRoom(columns: number | undefined, hint: string, shown = hint): number | undefined {
  if (columns === undefined) return undefined
  const mode = /shift\+tab/i.test(hint) ? MODE_LABEL : QUIET_MODE_LABEL
  return columns - EDGES - mode - width(shown) - SEP.length
}

/**
 * Claude Code's two standing hints, shortened. Any other hint (`esc to
 * interrupt`, a background shell's pill, a key to press twice) is left whole.
 */
export const SHORT_HINTS: Record<string, string> = { '(shift+tab to cycle)': '⇧⇥', '? for shortcuts': '?' }

/**
 * The hint line's props with glanceline's text added: after a shortened
 * standing hint (a rewritten hint replaces the engine's tail, so only when
 * there is none), else as the tail the engine draws after its own hint.
 */
export function withText<P extends { hint: string; tail?: string }>(props: P, text: string, short: boolean): P {
  if (!text) return props
  const brief = short && !props.tail ? SHORT_HINTS[props.hint] : undefined
  if (brief !== undefined) return { ...props, hint: `${brief} · ${text}` }
  return { ...props, tail: props.tail ? `${props.tail} · ${text}` : text }
}

/** The hint as it will show: shortened where `withText` would shorten it. */
export function shownHint(hint: string, short: boolean): string {
  return (short && SHORT_HINTS[hint]) || hint
}

/** Keys only the mod can fill, placed where a custom `segments` layout names them. */
export const MOD_KEYS = ['agents', 'compact', 'today'] as const

/**
 * Every segment on one line, the account last, fitted to `room`: segments
 * narrow together and the least important go first. Mod-only segments
 * (`extras`) stand where the layout names them. Empty under four columns,
 * where the engine would leave the tail out anyway.
 */
export function inline(p: Payload, o: Options, account?: string | null, room?: number,
  extras: Partial<Record<string, Segment | undefined>> = {}, trailing: Segment[] = []): Placed[] {
  const core = new Map(segments(p, o).flat().map(segment => [segment.key, segment]))
  const items: Segment[] = []
  for (const key of layoutKeys(o).flat()) {
    const segment = core.get(key) ?? extras[key]
    if (segment) items.push(segment)
  }
  items.push(...trailing)
  const extra = accountSegment(account)
  if (extra) items.push(extra)
  if (!items.length || (room !== undefined && room < 4)) return []
  return fit(items, room)
}

/** Columns to keep free for the footer's mode labels at the right of the hint row, with a clear gap before them. */
export function modesWidth(labels: readonly string[]): number {
  return labels.length ? width(labels.join(' & ')) + 4 : 0
}

export function joined(parts: Placed[]): string {
  return parts.map(part => part.text).join(SEP)
}
