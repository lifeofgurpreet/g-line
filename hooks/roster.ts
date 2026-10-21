// The sessions on this machine: each g-line session writes a heartbeat to
// Claude Code's plugin store (shared by every session on the machine, and
// nowhere else), and reads the others'. Line 2 says how many others there are
// and how many wait on you; the pane lists them.
//
// Pure: the mod hands in the store's entries, these decide what they say.

import type { Segment } from './core'

export type RosterState = 'working' | 'waiting' | 'idle'

export type RosterEntry = {
  id: string
  /** When the session last wrote (ms). */
  at: number
  state: RosterState
  /** Since when it has been in that state (ms). */
  since: number
  /** Context used, percent. */
  ctx?: number
  /** When its prompt cache is estimated to lapse (seconds), while warm. */
  cacheUntil?: number
  model?: string
  /** The `account_command` reading, only where the person configured one. */
  account?: string
}

/** A session that hasn't written for this long is gone (it ended, or its machine slept). */
export const ROSTER_STALE_MS = 60_000

/** The store keys of the roster: `s:<session id>`. */
export const ROSTER_PREFIX = 's:'

/** The entries the store holds that are fresh and well formed, the newest first. */
export function rosterOf(entries: readonly { key: string; value: unknown }[], nowMs: number): RosterEntry[] {
  const out: RosterEntry[] = []
  for (const { key, value } of entries) {
    if (!key.startsWith(ROSTER_PREFIX) || !value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    if (typeof v.at !== 'number' || nowMs - v.at > ROSTER_STALE_MS) continue
    const state = v.state === 'working' || v.state === 'waiting' || v.state === 'idle' ? v.state : undefined
    if (!state) continue
    out.push({
      id: key.slice(ROSTER_PREFIX.length), at: v.at, state, since: typeof v.since === 'number' ? v.since : v.at,
      ...(typeof v.ctx === 'number' ? { ctx: v.ctx } : {}),
      ...(typeof v.cacheUntil === 'number' ? { cacheUntil: v.cacheUntil } : {}),
      ...(typeof v.model === 'string' ? { model: v.model.slice(0, 40) } : {}),
      ...(typeof v.account === 'string' ? { account: v.account.slice(0, 120) } : {}),
    })
  }
  return out.sort((a, b) => b.at - a.at)
}

/** Keys of entries a day or more old: left behind by sessions that never said goodbye. */
export function staleRosterKeys(entries: readonly { key: string; value: unknown }[], nowMs: number): string[] {
  return entries.filter(({ key, value }) => key.startsWith(ROSTER_PREFIX)
    && !(value && typeof value === 'object' && typeof (value as { at?: unknown }).at === 'number'
      && nowMs - (value as { at: number }).at < 86_400_000)).map(({ key }) => key)
}

/** Line 2's `2 others · 1 waiting`: only when there are others; the waiting count is amber. */
export function othersSegment(others: readonly RosterEntry[]): Segment | undefined {
  if (!others.length) return undefined
  const waiting = others.filter(o => o.state === 'waiting').length
  const n = `${others.length} ${others.length === 1 ? 'other' : 'others'}`
  if (waiting) return { key: 'others', priority: 38, tone: 'warn', forms: [`${n} · ${waiting} waiting`, `${waiting} waiting`] }
  return { key: 'others', priority: 30, forms: [n] }
}

const ago = (ms: number) => {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? '<1m' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** One pane row per session: what it's doing and for how long, its context, its cache, its model and account. */
export function rosterRow(e: RosterEntry, nowMs: number, mine: boolean): string {
  const what = e.state === 'waiting' ? `waiting on you ${ago(nowMs - e.since)}` : `${e.state} ${ago(nowMs - e.since)}`
  const cache = e.cacheUntil !== undefined
    ? e.cacheUntil * 1000 > nowMs ? `cache ~${ago(e.cacheUntil * 1000 - nowMs)}` : 'cache cold' : ''
  return [mine ? `${what} (this one)` : what, e.ctx !== undefined ? `ctx ${Math.round(e.ctx)}%` : '', cache, e.model ?? '', e.account ?? '']
    .filter(Boolean).join(' · ')
}
