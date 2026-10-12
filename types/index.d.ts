/** What the mod has seen of the session, kept by the host across reloads. */
export type Snap = {
  /** Model id the last main-loop request named. */
  model?: string
  effort?: string
  context?: { tokens?: number; window?: number; percent?: number }
  rateLimits?: { kind: string; percentUsed: number; resetsAt?: number }[]
  costUsd?: number
  /** Milliseconds since the epoch. */
  startedAt?: number
  cache?: {
    /** Unix seconds the last main-loop request started. */
    lastAt: number
    /** Whether that response reported cache tokens. */
    cached: boolean
    /** Tokens the next request rewrites if the cache is cold. */
    prefix: number
    /** TTL learned from a hit or miss after an idle gap. */
    learned?: '5m' | '1h'
  }
  git?: { branch?: string; dirty?: boolean } | null
  account?: string | null
}

declare module 'claude-code' {
  interface PluginState {
    glanceline: { snap: Snap; tick: number; seen: string[]; hidden: boolean }
  }
}
