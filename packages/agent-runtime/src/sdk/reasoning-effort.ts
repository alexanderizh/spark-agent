export type SparkReasoningEffort = 'medium' | 'high' | 'xhigh' | 'max'
export type ClaudeReasoningEffort = 'medium' | 'high' | 'max'
export type CodexReasoningEffort = 'medium' | 'high' | 'xhigh'
export type OpenAIResponsesReasoningEffort = 'medium' | 'high'

export function normalizeSparkReasoningEffort(
  value: unknown,
  fallback: SparkReasoningEffort = 'max',
): SparkReasoningEffort {
  if (value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max') return value
  if (value === 'low') return 'medium'
  return fallback
}

export function toClaudeReasoningEffort(
  effort: SparkReasoningEffort | undefined,
): ClaudeReasoningEffort | undefined {
  if (effort == null) return undefined
  return effort === 'xhigh' ? 'max' : effort
}

export function toCodexReasoningEffort(
  effort: SparkReasoningEffort | undefined,
): CodexReasoningEffort | undefined {
  if (effort == null) return undefined
  return effort === 'max' ? 'xhigh' : effort
}

export function toOpenAIResponsesReasoningEffort(
  effort: SparkReasoningEffort | undefined,
): OpenAIResponsesReasoningEffort | undefined {
  if (effort == null) return undefined
  return effort === 'medium' ? 'medium' : 'high'
}
