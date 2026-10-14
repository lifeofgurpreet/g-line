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
  /** The largest prompt-cache write of one main-loop request in the turn. */
  cacheWrite?: number
  /** Whether the session had a cache before the turn, so a first write is no news. */
  warmBefore?: boolean
  /** Failed tool calls in the main loop; `tool` names the tool when they were all one. */
  failures?: number
  failedTool?: string
  /** A background agent overlapped the turn, so the session's cost growth is not the turn's alone. */
  overlap?: boolean
  /** The turn's first request rebuilt a prompt cache that had gone cold. */
  cold?: boolean
  /** A compaction ran during the turn, with its size before and after. */
  compacted?: { before?: number; after?: number }
  /** The context window size, for what counts as a big jump. */
  window?: number
  /** The turn's cost over the median of the recent attributable turns, fixed when it closed. */
  ratio?: number
}

/** The turn running now, for the spinner. */
export type TurnLive = {
  id: string
  startAt: number
  costAt?: number
  contextAt?: number
  tools: number
  agents: number
  failures?: number
  /** The tool that failed, while every failure was the same tool; null once they differ. */
  failedTool?: string | null
  /** What the failing calls worked on (a file's name, a command's first words), while it was the same. */
  failedTarget?: string | null
  /** Context tokens the turn has added so far, from its latest request. */
  contextGrowth?: number
  cacheWrite?: number
  warmBefore?: boolean
  cold?: boolean
  overlap?: boolean
  compacted?: { before?: number; after?: number }
}

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
  /** Main-loop input tokens read from the cache, and all main-loop input tokens, for a weighted hit rate. */
  cacheRead?: number
  inputTokens?: number
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

/** One headline from g-line's Pulse feed, cleaned. */
export type PulseItem = { title: string; url: string; source: string; at?: string }

/** The feed as last fetched. */
export type PulseFeed = { fetchedAt: number; generatedAt?: string; items: PulseItem[] }

declare module 'claude-code' {
  interface PluginState {
    'g-line': {
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
      pulse: PulseFeed | null
    }
  }
}
