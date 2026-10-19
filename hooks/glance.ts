// What Claude reads when it calls g-line's `status` tool, which is off unless
// turned on (`claude_reads: true`): a small JSON snapshot of the session's
// reported context, the account's usage windows and the estimated prompt-cache
// expiry. Observations only, with their scope and basis; never advice.
//
// Pure, like core.ts; the mod hands in the figures, the tests call it.

import { num, pace, roundEta } from './core'
import type { Payload } from './core'

export const STATUS_TOOL = 'status'

export const STATUS_DESCRIPTION = [
  "Read this Claude Code session's reported context use and automatic-compaction headroom, the account's usage windows,",
  'and the estimated prompt-cache expiry, as g-line observed them.',
  'Use when the user asks about these figures or explicitly requests a capacity check.',
  'This tool observes state; it changes no settings. Estimates may be stale and are not task budgets.',
  'Do not poll, send keep-alive prompts, reduce requested work, or change model, effort or compaction settings',
  'based on this result without the user\'s authorization.',
].join(' ')

export const STATUS_SCHEMA = {
  type: 'object',
  properties: { section: { type: 'string', enum: ['all', 'context', 'limits', 'cache'], description: 'Which part to read; all by default.' } },
}

export type StatusInput = {
  p: Payload
  /** Unix seconds now, and when the figures were last observed. */
  now: number
  observedAt?: number
  /** Tokens at which auto-compact runs, when it is on; undefined when off or unknown. */
  compactAt?: number
  compactOn?: boolean
  section?: string
  disabled?: boolean
}

const iso = (seconds: number | undefined) => (seconds === undefined ? null : new Date(Math.floor(seconds) * 1000).toISOString())

function window(p: Payload, kind: 'five_hour' | 'seven_day', now: number) {
  const w = p.rate_limits?.[kind]
  const used = num(w?.used_percentage)
  if (used === undefined) return null
  const state = pace(kind, w, now)
  return {
    used_percent: Math.round(used),
    resets_at: iso(num(w?.resets_at)),
    projected_limit_at: state?.kind === 'hot' ? iso(roundEta(state.eta, now)) : state?.kind === 'full' ? 'reached' : null,
  }
}

/** The snapshot as a JSON string. Unknown stays null; nothing is guessed. */
export function statusJson(s: StatusInput): string {
  if (s.disabled) return JSON.stringify({ schema: 1, state: 'disabled', note: 'g-line is turned off in this session (/g-line on turns it back on).' })
  const section = ['context', 'limits', 'cache'].includes(s.section ?? '') ? s.section : 'all'
  const out: Record<string, unknown> = { schema: 1, captured_at: iso(s.now), observed_at: iso(s.observedAt) }
  if (section === 'all' || section === 'context') {
    const w = s.p.context_window
    const used = num(w?.total_input_tokens)
    out.context = {
      scope: 'main_session',
      used_tokens: used ?? null,
      window_tokens: num(w?.context_window_size) ?? null,
      used_percent: num(w?.used_percentage) === undefined ? null : Math.round(num(w?.used_percentage) ?? 0),
      auto_compact: s.compactOn === false
        ? { enabled: false }
        : { enabled: s.compactAt !== undefined ? true : null, threshold_tokens: s.compactAt ?? null,
            headroom_tokens: s.compactAt !== undefined && used !== undefined ? Math.max(0, s.compactAt - used) : null,
            basis: 'engine_local_estimate' },
    }
  }
  if (section === 'all' || section === 'limits') {
    out.limits = {
      scope: 'account',
      five_hour: window(s.p, 'five_hour', s.now),
      seven_day: window(s.p, 'seven_day', s.now),
      projection_basis: 'rounded_linear_since_window_start',
    }
  }
  if (section === 'all' || section === 'cache') {
    const c = s.p.prompt_cache
    const expires = num(c?.expires_at)
    out.cache = c?.caching_observed
      ? { scope: 'main_session_last_request',
          state: c.compacted ? 'compacted' : c.warm && expires !== undefined && expires > s.now ? 'estimated_warm' : 'estimated_cold',
          estimated_expires_at: iso(expires), lifetime: c.ttl ?? null, rebuild_tokens_if_cold: num(c.recache_tokens_if_cold) ?? null,
          basis: 'configured_ttl_and_observed_request' }
      : null
  }
  return JSON.stringify(out)
}
