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
  /** Highest percent seen per usage window, keyed `<kind>:<resets at>`. */
  peaks?: Record<string, number>
}

/** One finished main-loop turn, drawn at the end of its "Baked for 3s" line. */
export type Receipt = {
  /** Dollars the session's cost ledger grew by during the turn (API prices). */
  cost?: number
  /** Share of the turn's input read from the prompt cache, 0 to 100. */
  cacheHit?: number
  /** Context tokens the turn added (negative after a compaction). */
  context?: number
  tools: number
  agents: number
  /** Output tokens the main loop produced. */
  output?: number
  /** Milliseconds since the epoch the turn ended. */
  endAt: number
  durationMs: number
  /** Background work was still running when the turn ended. */
  background: boolean
}

/** The turn running now, for the spinner. */
export type TurnLive = { id: string; startAt: number; costAt?: number; contextAt?: number; tools: number; agents: number }

export type AgentRow = {
  id: string
  description: string
  type: string
  model?: string
  status: string
  background: boolean
  teammate: boolean
  /** Milliseconds since the epoch. */
  startedAt: number
  endedAt?: number
}

export type Compaction = { at: number; trigger: string; before?: number; after?: number }

export type Forecast = { turns: number; percent: number; threshold: number }

/** What the session has done, for the pane and the card. */
export type Totals = {
  turns: number
  tools: number
  failures: number
  agents: number
  /** Turns whose first request rebuilt a cold prompt cache. */
  colds: number
  peakContext: number
  /** Per tool: calls and failures. */
  byTool: Record<string, { calls: number; failures: number }>
  compactions: Compaction[]
  /** Context growth of the last main-loop turns, for the forecast. */
  growth: number[]
}

/** The context window by category, as /context counts it locally. */
export type ContextView = {
  at: number
  total: number
  max: number
  threshold?: number
  rows: { name: string; tokens: number; kind: string }[]
  mcp: { server: string; tokens: number; tools: number }[]
  memoryFiles: number
  memoryTokens: number
  skills?: { count: number; tokens: number }
}

/** One day's figures, summed over every session the mod ran in on this machine. */
export type Day = { day: string; cost: number; turns: number; tools: number; sessions: number; colds: number; agents: number }

export type Ledger = { today: Day; week: Day[] }

declare module 'claude-code' {
  interface PluginState {
    glanceline: {
      snap: Snap
      tick: number
      seen: string[]
      hidden: boolean
      receipts: Record<string, Receipt>
      turn: TurnLive | null
      agents: AgentRow[]
      totals: Totals
      forecast: Forecast | null
      context: ContextView | null
      ledger: Ledger | null
      view: 'details' | 'card'
    }
  }
}
