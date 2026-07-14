import {
  ModelCapabilityRegistry,
} from '@spark/shared'

export const STORYBOARD_CONTEXT_DERIVED_MIN_MAX_TOKENS = 8_192
export const STORYBOARD_CONTEXT_DERIVED_MAX_TOKENS_CAP = 65_536
export const STORYBOARD_PROMPT_OVERHEAD_TOKENS = 2_048
export const STORYBOARD_OUTPUT_RESERVE_TOKENS = 4_096
export const GENERAL_CONTEXT_DERIVED_MIN_MAX_TOKENS = 8_192
export const GENERAL_CONTEXT_DERIVED_MAX_TOKENS_CAP = 65_536

export type CanvasTextMaxTokensSource =
  | 'request'
  | 'provider_profile'
  | 'model_capability'
  | 'context_window_derived'

export type CanvasTextTokenBudget = {
  maxTokens?: number
  source?: CanvasTextMaxTokensSource
  promptTokensEstimate?: number
  providerMaxTokens?: number
  providerContextWindow?: number
  modelContextWindow?: number
  modelMaxOutputTokens?: number
}

type CanvasTextRawResponseInput = {
  providerProfileId: string
  provider: string
  providerName: string
  model: string
  apiKind: 'chat' | 'responses'
  agentId?: string | null
  agentName?: string | null
  skillIds?: string[]
  relationManifest?: unknown
  taskPipelineRole?: string | null
  outputText?: string
  statusCode?: number
  errorBody?: string
  effectiveMaxTokens?: number
  maxTokensSource?: CanvasTextMaxTokensSource
  promptTokensEstimate?: number
  providerMaxTokens?: number
  providerContextWindow?: number
  modelContextWindow?: number
  modelMaxOutputTokens?: number
  providerFinishReason?: string
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  reasoningContentChars?: number
}

export function resolveCanvasTextTokenBudget(input: {
  requestedMaxTokens?: number
  providerMaxTokens?: number
  providerContextWindow?: number
  providerSupportsMillionContext?: boolean
  model?: string
  taskPipelineRole?: string | null
  prompt: string
}): CanvasTextTokenBudget {
  const requested = sanitizePositiveInteger(input.requestedMaxTokens)
  if (requested != null) return { maxTokens: requested, source: 'request' }

  const providerMaxTokens = sanitizePositiveInteger(input.providerMaxTokens)
  const modelCapability =
    typeof input.model === 'string' && input.model.trim().length > 0
      ? ModelCapabilityRegistry.getCapabilities(input.model)
      : undefined
  const modelMaxOutputTokens = sanitizePositiveInteger(modelCapability?.maxOutputTokens)
  const modelContextWindow = sanitizePositiveInteger(modelCapability?.contextWindow)
  const providerContextWindow = sanitizePositiveInteger(
    typeof input.providerContextWindow === 'number' && input.providerContextWindow > 0
      ? input.providerContextWindow
      : input.providerSupportsMillionContext === true
        ? 1_000_000
        : undefined,
  )
  const promptTokensEstimate = estimatePromptTokens(input.prompt)

  if (providerMaxTokens != null) {
    return {
      maxTokens: modelMaxOutputTokens != null
        ? Math.min(providerMaxTokens, modelMaxOutputTokens)
        : providerMaxTokens,
      source: 'provider_profile',
      promptTokensEstimate,
      providerMaxTokens,
      providerContextWindow,
      modelContextWindow,
      modelMaxOutputTokens,
    }
  }

  if (modelMaxOutputTokens != null) {
    return {
      maxTokens: modelMaxOutputTokens,
      source: 'model_capability',
      promptTokensEstimate,
      providerContextWindow,
      modelContextWindow,
      modelMaxOutputTokens,
    }
  }

  const effectiveContextWindow = Math.max(providerContextWindow ?? 0, modelContextWindow ?? 0)
  if (effectiveContextWindow <= 0) return {}
  const isStoryboardTask = input.taskPipelineRole === 'shot'

  const availableOutputTokens = effectiveContextWindow
    - promptTokensEstimate
    - STORYBOARD_PROMPT_OVERHEAD_TOKENS
    - STORYBOARD_OUTPUT_RESERVE_TOKENS

  return {
    maxTokens: clamp(
      availableOutputTokens,
      isStoryboardTask
        ? STORYBOARD_CONTEXT_DERIVED_MIN_MAX_TOKENS
        : GENERAL_CONTEXT_DERIVED_MIN_MAX_TOKENS,
      isStoryboardTask
        ? STORYBOARD_CONTEXT_DERIVED_MAX_TOKENS_CAP
        : GENERAL_CONTEXT_DERIVED_MAX_TOKENS_CAP,
    ),
    source: 'context_window_derived',
    promptTokensEstimate,
    providerContextWindow,
    modelContextWindow,
  }
}

export function resolveCanvasTextMaxTokens(input: Parameters<typeof resolveCanvasTextTokenBudget>[0]): number | undefined {
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
    ...(input.promptTokensEstimate !== undefined ? { promptTokensEstimate: input.promptTokensEstimate } : {}),
    ...(input.providerMaxTokens !== undefined ? { providerMaxTokens: input.providerMaxTokens } : {}),
    ...(input.providerContextWindow !== undefined ? { providerContextWindow: input.providerContextWindow } : {}),
    ...(input.modelContextWindow !== undefined ? { modelContextWindow: input.modelContextWindow } : {}),
    ...(input.modelMaxOutputTokens !== undefined ? { modelMaxOutputTokens: input.modelMaxOutputTokens } : {}),
    ...(input.providerFinishReason !== undefined ? { providerFinishReason: input.providerFinishReason } : {}),
    ...(input.usage !== undefined ? { usage: input.usage } : {}),
    ...(input.reasoningContentChars !== undefined ? { reasoningContentChars: input.reasoningContentChars } : {}),
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}
