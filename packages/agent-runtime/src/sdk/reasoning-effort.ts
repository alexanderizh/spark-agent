export type SparkReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ClaudeReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type OpenAIResponsesReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export function normalizeSparkReasoningEffort(
  value: unknown,
  fallback: SparkReasoningEffort = 'max',
): SparkReasoningEffort {
  if (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  ) {
    return value
  }
  return fallback
}

export function toClaudeReasoningEffort(
  effort: SparkReasoningEffort | undefined,
): ClaudeReasoningEffort | undefined {
  if (effort == null) return undefined
  return effort === 'minimal' ? 'low' : effort
}

export function toCodexReasoningEffort(
  effort: SparkReasoningEffort | undefined,
): CodexReasoningEffort | undefined {
  if (effort == null) return undefined
  if (effort === 'minimal') return 'low'
  return effort === 'max' ? 'xhigh' : effort
}

export function toOpenAIResponsesReasoningEffort(
  effort: SparkReasoningEffort | undefined,
): OpenAIResponsesReasoningEffort | undefined {
  if (effort == null) return undefined
  return effort === 'max' ? 'xhigh' : effort
}
