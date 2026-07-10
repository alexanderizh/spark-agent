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
