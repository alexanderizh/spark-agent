import { resolveProviderContextWindow } from '@spark/shared'

/** 画布文本任务始终为输入、系统提示词和输出预留 15% 的上下文空间。 */
export const CANVAS_TEXT_CONTEXT_RESERVE_RATIO = 0.15
const CANVAS_TEXT_CONTEXT_BUDGET_RATIO = 1 - CANVAS_TEXT_CONTEXT_RESERVE_RATIO

export type CanvasTextMaxTokensSource = 'request' | 'provider_profile' | 'context_window_derived'

export type CanvasTextTokenBudget = {
  maxTokens?: number
  source?: CanvasTextMaxTokensSource
  promptTokensEstimate?: number
  providerMaxTokens?: number
  providerContextWindow?: number
  contextWindow?: number
  contextReserveRatio?: number
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
  maxTokensSource?: CanvasTextMaxTokensSource | undefined
  promptTokensEstimate?: number | undefined
  providerMaxTokens?: number | undefined
  providerContextWindow?: number | undefined
  contextWindow?: number | undefined
  contextReserveRatio?: number | undefined
  providerFinishReason?: string | undefined
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined
  reasoningContentChars?: number | undefined
}

export function resolveCanvasTextTokenBudget(input: {
  requestedMaxTokens?: number | undefined
  providerMaxTokens?: number | undefined
  providerContextWindow?: number | undefined
  providerSupportsMillionContext?: boolean | undefined
  taskPipelineRole?: string | null | undefined
  prompt: string
}): CanvasTextTokenBudget {
  const requested = sanitizePositiveInteger(input.requestedMaxTokens)
  const providerMaxTokens = sanitizePositiveInteger(input.providerMaxTokens)
  const providerContextWindow = resolveProviderContextWindow(
    input.providerSupportsMillionContext,
    input.providerContextWindow,
  )
  const promptTokensEstimate = estimatePromptTokens(input.prompt)

  // contextWindow 是输入 + 输出的总窗口。输出预算最多使用 85%，
  // 同时不能挤占当前 prompt 已经占用的空间。
  const contextDerivedMaxTokens = Math.max(
    1,
    Math.min(
      Math.floor(providerContextWindow * CANVAS_TEXT_CONTEXT_BUDGET_RATIO),
      providerContextWindow - promptTokensEstimate,
    ),
  )
  const limits = [contextDerivedMaxTokens, providerMaxTokens, requested].filter(
    (value): value is number => value != null,
  )
  const source: CanvasTextMaxTokensSource =
    requested != null
      ? 'request'
      : providerMaxTokens != null
        ? 'provider_profile'
        : 'context_window_derived'

  return {
    maxTokens: Math.max(1, Math.min(...limits)),
    source,
    promptTokensEstimate,
    providerContextWindow,
    contextWindow: providerContextWindow,
    contextReserveRatio: CANVAS_TEXT_CONTEXT_RESERVE_RATIO,
    ...(providerMaxTokens != null ? { providerMaxTokens } : {}),
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
    ...(input.maxTokensSource !== undefined ? { maxTokensSource: input.maxTokensSource } : {}),
    ...(input.promptTokensEstimate !== undefined
      ? { promptTokensEstimate: input.promptTokensEstimate }
      : {}),
    ...(input.providerMaxTokens !== undefined
      ? { providerMaxTokens: input.providerMaxTokens }
      : {}),
    ...(input.providerContextWindow !== undefined
      ? { providerContextWindow: input.providerContextWindow }
      : {}),
    ...(input.contextWindow !== undefined ? { contextWindow: input.contextWindow } : {}),
    ...(input.contextReserveRatio !== undefined
      ? { contextReserveRatio: input.contextReserveRatio }
      : {}),
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
    if (/[\x00-\x7f]/.test(char)) {
      tokens += 0.35
      continue
    }
    tokens += 0.6
  }
  return Math.max(1, Math.ceil(tokens))
}
