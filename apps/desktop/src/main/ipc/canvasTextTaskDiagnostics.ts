import { resolveModelContextWindow, resolveProviderContextWindow } from '@spark/shared'

/** 上下文只作越界保护，不再按窗口比例推导单次输出。 */
export const CANVAS_TEXT_CONTEXT_SAFETY_TOKENS = 16_384

export const CANVAS_TEXT_OUTPUT_TIERS = {
  minimum: 16_384,
  standard: 32_768,
  long: 65_536,
  explicitMaximum: 131_072,
} as const

export type CanvasTextMaxTokensSource =
  | 'request'
  | 'learned_model_cap'
  | 'provider_profile'
  | 'task_default'
  | 'context_remaining'

export class CanvasTextContextBudgetError extends Error {
  readonly code = 'context_budget_exhausted'
  readonly contextWindow: number
  readonly promptTokensEstimate: number

  constructor(contextWindow: number, promptTokensEstimate: number) {
    super(
      `画布文本输入已占满模型上下文（估算 ${promptTokensEstimate} / ${contextWindow} tokens），请减少输入或更换更大上下文模型。`,
    )
    this.name = 'CanvasTextContextBudgetError'
    this.contextWindow = contextWindow
    this.promptTokensEstimate = promptTokensEstimate
  }
}

export type CanvasTextTokenBudget = {
  maxTokens: number
  source: CanvasTextMaxTokensSource
  desiredMaxTokens: number
  promptTokensEstimate: number
  providerMaxTokens?: number
  learnedMaxTokens?: number
  providerContextWindow: number
  contextWindow: number
  remainingContextTokens: number
  contextSafetyTokens: number
}

type CanvasTextRawResponseInput = {
  providerProfileId: string
  provider: string
  providerName: string
  model: string
  apiKind: 'chat' | 'responses'
  agentId?: string | null | undefined
  agentName?: string | null | undefined
  skillIds?: string[] | undefined
  relationManifest?: unknown | undefined
  taskPipelineRole?: string | null | undefined
  outputText?: string | undefined
  statusCode?: number | undefined
  errorBody?: string | undefined
  effectiveMaxTokens?: number | undefined
  desiredMaxTokens?: number | undefined
  maxTokensSource?: CanvasTextMaxTokensSource | undefined
  promptTokensEstimate?: number | undefined
  providerMaxTokens?: number | undefined
  learnedMaxTokens?: number | undefined
  providerContextWindow?: number | undefined
  contextWindow?: number | undefined
  remainingContextTokens?: number | undefined
  contextSafetyTokens?: number | undefined
  learnedOutputCap?: number | undefined
  outputLimitRetryCount?: number | undefined
  outputLimitAttempts?: number[] | undefined
  outputLimitEvidence?: string | undefined
  requestTimeoutMs?: number | undefined
  providerFinishReason?: string | undefined
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined
  reasoningContentChars?: number | undefined
}

export function resolveCanvasTextTokenBudget(input: {
  operation?: string | undefined
  modelId?: string | undefined
  requestedMaxTokens?: number | undefined
  providerMaxTokens?: number | undefined
  learnedMaxTokens?: number | undefined
  providerContextWindow?: number | undefined
  providerSupportsMillionContext?: boolean | undefined
  taskPipelineRole?: string | null | undefined
  prompt: string
}): CanvasTextTokenBudget {
  const requestedValue = sanitizePositiveInteger(input.requestedMaxTokens)
  const requested = requestedValue == null
    ? undefined
    : Math.min(
        CANVAS_TEXT_OUTPUT_TIERS.explicitMaximum,
        Math.max(CANVAS_TEXT_OUTPUT_TIERS.minimum, requestedValue),
      )
  const providerMaxTokens = sanitizePositiveInteger(input.providerMaxTokens)
  const learnedMaxTokens = sanitizePositiveInteger(input.learnedMaxTokens)
  const configuredContextWindow = sanitizePositiveInteger(input.providerContextWindow)
  const providerContextWindow = configuredContextWindow
    ?? (input.providerSupportsMillionContext === true
      ? resolveProviderContextWindow(true)
      : input.modelId?.trim()
        ? resolveModelContextWindow(input.modelId)
        : resolveProviderContextWindow())
  const promptTokensEstimate = estimatePromptTokens(input.prompt)
  const desiredMaxTokens = requested
    ?? resolveTaskDefaultMaxTokens(input.operation, input.taskPipelineRole)
  const remainingContextTokens =
    providerContextWindow - promptTokensEstimate - CANVAS_TEXT_CONTEXT_SAFETY_TOKENS
  if (remainingContextTokens <= 0) {
    throw new CanvasTextContextBudgetError(providerContextWindow, promptTokensEstimate)
  }
  const constraints: Array<{ value: number; source: CanvasTextMaxTokensSource }> = [
    { value: desiredMaxTokens, source: requested != null ? 'request' : 'task_default' },
    ...(learnedMaxTokens != null
      ? [{ value: learnedMaxTokens, source: 'learned_model_cap' as const }]
      : []),
    ...(providerMaxTokens != null
      ? [{ value: providerMaxTokens, source: 'provider_profile' as const }]
      : []),
    { value: remainingContextTokens, source: 'context_remaining' },
  ]
  const effective = constraints.reduce((smallest, item) =>
    item.value < smallest.value ? item : smallest,
  )

  return {
    maxTokens: effective.value,
    source: effective.source,
    desiredMaxTokens,
    promptTokensEstimate,
    providerContextWindow,
    contextWindow: providerContextWindow,
    remainingContextTokens,
    contextSafetyTokens: CANVAS_TEXT_CONTEXT_SAFETY_TOKENS,
    ...(providerMaxTokens != null ? { providerMaxTokens } : {}),
    ...(learnedMaxTokens != null ? { learnedMaxTokens } : {}),
  }
}

export function resolveCanvasTextMaxTokens(
  input: Parameters<typeof resolveCanvasTextTokenBudget>[0],
): number | undefined {
  return resolveCanvasTextTokenBudget(input).maxTokens
}

export function buildCanvasTextRawResponse(
  input: CanvasTextRawResponseInput,
): Record<string, unknown> {
  const output = {
    providerProfileId: input.providerProfileId,
    provider: input.provider,
    providerName: input.providerName,
    model: input.model,
    apiKind: input.apiKind,
    agentId: input.agentId ?? null,
    agentName: input.agentName ?? null,
    skillIds: input.skillIds ?? [],
    relationManifest: input.relationManifest ?? [],
    ...(input.statusCode !== undefined ? { statusCode: input.statusCode } : {}),
    ...(input.errorBody !== undefined ? { errorBody: input.errorBody } : {}),
    ...(input.outputText !== undefined ? { outputText: input.outputText } : {}),
    ...(input.effectiveMaxTokens !== undefined ? { maxTokens: input.effectiveMaxTokens } : {}),
    ...(input.desiredMaxTokens !== undefined
      ? { desiredMaxTokens: input.desiredMaxTokens }
      : {}),
    ...(input.maxTokensSource !== undefined ? { maxTokensSource: input.maxTokensSource } : {}),
    ...(input.promptTokensEstimate !== undefined
      ? { promptTokensEstimate: input.promptTokensEstimate }
      : {}),
    ...(input.providerMaxTokens !== undefined
      ? { providerMaxTokens: input.providerMaxTokens }
      : {}),
    ...(input.learnedMaxTokens !== undefined ? { learnedMaxTokens: input.learnedMaxTokens } : {}),
    ...(input.providerContextWindow !== undefined
      ? { providerContextWindow: input.providerContextWindow }
      : {}),
    ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : {}),
    ...(input.remainingContextTokens !== undefined
      ? { remainingContextTokens: input.remainingContextTokens }
      : {}),
    ...(input.contextSafetyTokens !== undefined
      ? { contextSafetyTokens: input.contextSafetyTokens }
      : {}),
    ...(input.learnedOutputCap !== undefined
      ? { learnedOutputCap: input.learnedOutputCap }
      : {}),
    ...(input.outputLimitRetryCount !== undefined
      ? { outputLimitRetryCount: input.outputLimitRetryCount }
      : {}),
    ...(input.outputLimitAttempts !== undefined
      ? { outputLimitAttempts: input.outputLimitAttempts }
      : {}),
    ...(input.outputLimitEvidence !== undefined
      ? { outputLimitEvidence: input.outputLimitEvidence }
      : {}),
    ...(input.requestTimeoutMs !== undefined ? { requestTimeoutMs: input.requestTimeoutMs } : {}),
    ...(input.providerFinishReason !== undefined
      ? { providerFinishReason: input.providerFinishReason }
      : {}),
    ...(input.usage !== undefined ? { usage: input.usage } : {}),
    ...(input.reasoningContentChars !== undefined
      ? { reasoningContentChars: input.reasoningContentChars }
      : {}),
  } satisfies Record<string, unknown>
  const truncation = detectCanvasTextTruncation(
    input.taskPipelineRole,
    input.outputText,
    input.providerFinishReason,
  )
  return truncation ? { ...output, truncation } : output
}

function sanitizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.max(1, Math.floor(value))
}

function resolveTaskDefaultMaxTokens(
  operation: string | undefined,
  taskPipelineRole: string | null | undefined,
): number {
  if (taskPipelineRole === 'screenplay' || taskPipelineRole === 'shot') {
    return CANVAS_TEXT_OUTPUT_TIERS.long
  }
  if (operation === 'prompt_optimize') return CANVAS_TEXT_OUTPUT_TIERS.minimum
  return CANVAS_TEXT_OUTPUT_TIERS.standard
}

function detectCanvasTextTruncation(
  taskPipelineRole: string | null | undefined,
  outputText: string | undefined,
  providerFinishReason?: string,
): { suspected: true; reason: string; tailPreview: string } | undefined {
  if (taskPipelineRole !== 'shot' || typeof outputText !== 'string') return undefined
  const trimmed = outputText.trim()
  if (trimmed.length === 0 || !/"shots"\s*:/.test(trimmed)) return undefined
  if (providerFinishReason === 'length') {
    return {
      suspected: true,
      reason: 'provider_finish_reason_length',
      tailPreview: trimmed.slice(-240),
    }
  }
  if (trimmed.endsWith('```')) return undefined
  if (!hasUnbalancedJsonDelimiters(trimmed)) return undefined
  return {
    suspected: true,
    reason: 'storyboard_output_incomplete',
    tailPreview: trimmed.slice(-240),
  }
}

function hasUnbalancedJsonDelimiters(text: string): boolean {
  let curly = 0
  let square = 0
  let inString = false
  let escape = false
  for (const char of text) {
    if (inString) {
      if (escape) escape = false
      else if (char === '\\') escape = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') curly += 1
    else if (char === '}') curly = Math.max(0, curly - 1)
    else if (char === '[') square += 1
    else if (char === ']') square = Math.max(0, square - 1)
  }
  return inString || curly > 0 || square > 0
}

function estimatePromptTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(char)) {
      tokens += 0.8
      continue
    }
    if ((char.codePointAt(0) ?? 0) <= 0x7f) {
      tokens += 0.35
      continue
    }
    tokens += 0.6
  }
  return Math.max(1, Math.ceil(tokens))
}
