import type { AgentEvent } from '@spark/protocol'

export type UsageSnapshot = {
  turnId: string
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  cacheHitTokens: number
  cacheWriteTokens: number
  estimatedCostUsd: number
  timestamp: string
}

/** 「轮次用量」面板单行：一轮一行（buildTurnUsageRows 输出） */
export type TurnUsageRow = {
  /** 真实轮次序号（1-based，按该轮首条上报的出现顺序计） */
  turnNumber: number
  /** 该轮终值快照：token/缓存取轮内最后一个非零值，成本为轮内累加 */
  snapshot: UsageSnapshot
}

export type SessionUsageData = {
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  cacheHitTokens: number
  cacheWriteTokens: number
  /** 最近一轮缓存命中率（cache_read / 输入总量，provider 口径见 computeCacheHitRate）；无缓存数据时为 null */
  cacheHitRate: number | null
  estimatedCostUsd: number
  contextWindow: number
  turns: UsageSnapshot[]
}

export type ContextUsageState = {
  estimatedTokens: number
  softLimitTokens: number
  contextWindowTokens: number
  compactedThisTurn: boolean
}

export type ContextLedgerSection = {
  label: string
  estimatedTokens: number
  charCount: number
  truncated: boolean
}

export type ContextLedgerState = {
  sections: ContextLedgerSection[]
  totalEstimatedTokens: number
  softLimitTokens: number
  contextWindowTokens: number
  usagePercent: number
}

export type ProjectContextState = Extract<AgentEvent, { type: 'project_context_loaded' }>
