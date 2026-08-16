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
