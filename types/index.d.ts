/** What the mod has seen of the session, kept by the host across reloads. */
export type Snap = {
  /** Model id the last main-loop request named. */
  model?: string
  effort?: string
  /** The effort the person set, when the guard ran the last main-loop request lower. */
  effortSet?: string
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
    /**
     * Tokens the conversation was compacted to since that request: the cached
     * prefix is gone, and the next request writes the summary whatever the time.
     * 0 when a compaction was seen but not its size.
     */
    compactedTo?: number
    /**
     * The `account_command` reading changed since this cache was written. Caches
     * are kept per organization, so the next request starts a new one.
     */
    accountChanged?: boolean
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
  /** The guard lowered the main conversation's effort for this turn. */
  guardEffort?: { from: string; to: string }
  /** Subagents the guard started on a cheaper model during the turn. */
  guardAgents?: number
  /** The guard ended the turn before its next request: how much of which window was left, and the week's pace when a pace rule ended it. */
  guardEnded?: { left: number; window: string; pace?: { used: number; allowed: number } }
  /** The account changed since the cache this turn found was written. */
  accountChanged?: boolean
  /** The model that answered, when it wasn't the one the request asked for (a fallback). */
  servedBy?: string
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
  guardEffort?: { from: string; to: string }
  guardAgents?: number
  guardEnded?: { left: number; window: string; pace?: { used: number; allowed: number } }
  servedBy?: string
  accountChanged?: boolean
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
export type Day = {
  day: string; cost: number; turns: number; tools: number; sessions: number; colds: number; agents: number
  /** Keep-warm's re-reads, and what they cost at API prices (included in `cost`) when the engine counted it. */
  warms?: number; warmCost?: number
}

export type Ledger = { today: Day; week: Day[] }

/** One headline from g-line's Pulse feed, cleaned. */
export type PulseItem = {
  title: string
  url: string
  source: string
  at?: string
  /** The whole post or summary, for the reader; the title when the feed has none. */
  text?: string
  likes?: number
  /** The author's display name on X (`Claude`), beside the handle in `source`. */
  author?: string
  /** The story a post on X is about, or what it quotes. */
  story?: string
  /** Who found a publisher's item (`Techmeme`), when `source` is the publisher. */
  via?: string
  /** Hacker News points, and its comments page. */
  points?: number
  discussion?: string
}

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
      view: 'details' | 'card' | 'settings' | 'news'
      pulse: PulseFeed | null
      /** The link of the headline Pulse shows now: the cycle's rules move it on. */
      pulseNow: string | null
      /** The reader's selected item. */
      newsAt: number
    }
  }
}
