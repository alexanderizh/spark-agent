import { KernelError } from '../kernel/errors.js'
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  type IrMessage,
  type IrToolDefinition,
  type ModelBudget,
  type SystemSection,
} from './types.js'

/** Minimum useful response budget for an agent step. */
export const MIN_OUTPUT_TOKENS = 256
/** Error-margin reserved for tokenizer/provider estimation drift. */
const CONTEXT_SAFETY_MARGIN_TOKENS = 512
/** Do not let a context-only fallback consume more than a quarter of context. */
const CONTEXT_FALLBACK_RATIO = 0.25
const CONTEXT_FALLBACK_CAP = 65_536

export interface ResolveOutputBudgetOptions {
  readonly requestedMaxTokens?: number
  readonly modelBudget?: ModelBudget
  readonly system: readonly SystemSection[]
  readonly messages: readonly IrMessage[]
  readonly tools: readonly IrToolDefinition[]
}

export interface ResolvedOutputBudget {
  readonly maxTokens: number
  readonly source: 'request' | 'model' | 'context-fallback' | 'sdk-fallback'
  readonly estimatedInputTokens: number
  readonly contextWindowTokens?: number
  readonly remainingContextTokens?: number
  readonly limitedByContext: boolean
}

/**
 * Resolve one protocol-neutral output ceiling before the request is encoded.
 * The provider/model ceiling wins over SDK defaults, and the context window
 * always caps the generated portion after an input estimate and safety margin.
 */
export function resolveOutputBudget(options: ResolveOutputBudgetOptions): ResolvedOutputBudget {
  const estimatedInputTokens = estimateRequestTokens(options)
  const contextWindowTokens = positiveInteger(options.modelBudget?.contextWindowTokens)
  const configuredMax = positiveInteger(options.modelBudget?.maxOutputTokens)
  const requestedMax = positiveInteger(options.requestedMaxTokens)

  const fallbackMax = contextWindowTokens
    ? Math.min(
        CONTEXT_FALLBACK_CAP,
        Math.max(MIN_OUTPUT_TOKENS, Math.floor(contextWindowTokens * CONTEXT_FALLBACK_RATIO)),
      )
    : DEFAULT_MAX_OUTPUT_TOKENS
  const preferred =
    requestedMax !== undefined
      ? { value: requestedMax, source: 'request' as const }
      : configuredMax !== undefined
        ? { value: configuredMax, source: 'model' as const }
        : contextWindowTokens !== undefined
          ? { value: fallbackMax, source: 'context-fallback' as const }
          : { value: fallbackMax, source: 'sdk-fallback' as const }

  const modelCappedValue =
    configuredMax === undefined ? preferred.value : Math.min(preferred.value, configuredMax)
  const effective =
    modelCappedValue !== preferred.value && requestedMax !== undefined
      ? { value: modelCappedValue, source: 'model' as const }
      : { value: modelCappedValue, source: preferred.source }

  if (contextWindowTokens === undefined) {
    return {
      maxTokens: effective.value,
      source: effective.source,
      estimatedInputTokens,
      limitedByContext: false,
    }
  }

  const remainingContextTokens =
    contextWindowTokens - estimatedInputTokens - CONTEXT_SAFETY_MARGIN_TOKENS
  if (remainingContextTokens < MIN_OUTPUT_TOKENS) {
    throw new KernelError(
      'llm.context_window_exhausted',
      `The prompt uses approximately ${estimatedInputTokens} tokens, leaving less than ${MIN_OUTPUT_TOKENS} tokens in the ${contextWindowTokens}-token context window. Compact the session or use a model with a larger context window.`,
      {
        retryable: false,
        detail: {
          estimatedInputTokens,
          contextWindowTokens,
          remainingContextTokens: Math.max(0, remainingContextTokens),
        },
      },
    )
  }

  const maxTokens = Math.min(effective.value, remainingContextTokens)
  return {
    maxTokens,
    source: effective.source,
    estimatedInputTokens,
    contextWindowTokens,
    remainingContextTokens,
    limitedByContext: maxTokens < effective.value,
  }
}

/**
 * A tokenizer-independent, intentionally conservative estimate. Exact token
 * counts are provider-specific; this guard is only used to avoid sending a
 * request that is obviously over the advertised context window.
 */
export function estimateRequestTokens(options: {
  readonly system: readonly SystemSection[]
  readonly messages: readonly IrMessage[]
  readonly tools: readonly IrToolDefinition[]
}): number {
  let total = 0
  for (const section of options.system) total += estimateTextTokens(section.content) + 16
  for (const message of options.messages) total += estimateMessageTokens(message)
  for (const tool of options.tools) {
    total += estimateTextTokens(tool.name) + estimateTextTokens(tool.description)
    total += estimateTextTokens(safeJson(tool.inputSchema)) + 32
  }
  return total
}

/**
 * Estimated wire cost of one projected message, including role framing
 * overhead. Used by the context compactor to compare conversation prefixes.
 */
export function estimateMessageTokens(message: IrMessage): number {
  if (message.role === 'user') {
    let total = estimateTextTokens(message.content) + 12
    for (const image of message.imageRefs ?? []) total += estimateImageTokens(image)
    return total
  }
  if (message.role === 'tool_result') {
    let total = estimateTextTokens(message.content) + 12
    for (const image of message.imageRefs ?? []) total += estimateImageTokens(image)
    return total
  }
  let total = estimateTextTokens(message.content) + estimateTextTokens(message.thinking) + 16
  for (const call of message.toolCalls) {
    total += estimateTextTokens(call.name) + estimateTextTokens(safeJson(call.args)) + 16
  }
  return total
}

/**
 * Conservative per-image estimate. Providers bill images by tiles or by
 * pixels, and none of them advertise the exact rule; taking the larger of the
 * two documented formulas keeps an oversized image from slipping past the
 * context guard, and an unknown size falls back to a fixed conservative cost.
 */
export const UNKNOWN_IMAGE_TOKENS = 1_600

export function estimateImageTokens(image: {
  readonly width?: number
  readonly height?: number
}): number {
  const width = image.width
  const height = image.height
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return UNKNOWN_IMAGE_TOKENS
  }
  const tileBased = Math.ceil(width / 512) * Math.ceil(height / 512) * 170 + 85
  const pixelBased = Math.ceil((width * height) / 750)
  return Math.max(tileBased, pixelBased)
}

export function estimateTextTokens(value: string | undefined): number {
  if (!value) return 0
  let ascii = 0
  let other = 0
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) ascii += 1
    else other += 1
  }
  // ASCII prose/code averages roughly 3 chars/token; CJK and emoji are much
  // closer to one token/code point. Rounding upward makes this a safety guard.
  return Math.ceil(ascii / 3) + other
}

export interface ContextBreakdownLine {
  readonly label: string
  readonly tokens: number
}

export interface ContextBreakdown {
  readonly system: readonly ContextBreakdownLine[]
  readonly systemTokens: number
  readonly tools: readonly ContextBreakdownLine[]
  readonly toolsTokens: number
  readonly userTokens: number
  readonly assistantTokens: number
  readonly toolResultTokens: number
  readonly messagesTokens: number
  readonly total: number
}

/**
 * Per-section / per-role context accounting for diagnostics (`/context`).
 * Same estimator as the output-budget guard, so the numbers reconcile with
 * the compaction thresholds.
 */
export function describeContextBreakdown(options: {
  readonly system: readonly SystemSection[]
  readonly messages: readonly IrMessage[]
  readonly tools: readonly IrToolDefinition[]
}): ContextBreakdown {
  const system = options.system.map((section) => ({
    label: section.id,
    tokens: estimateTextTokens(section.content) + 16,
  }))
  const tools = options.tools.map((tool) => ({
    label: tool.name,
    tokens:
      estimateTextTokens(tool.name) +
      estimateTextTokens(tool.description) +
      estimateTextTokens(safeJson(tool.inputSchema)) +
      32,
  }))
  let userTokens = 0
  let assistantTokens = 0
  let toolResultTokens = 0
  for (const message of options.messages) {
    if (message.role === 'user') userTokens += estimateMessageTokens(message)
    else if (message.role === 'tool_result') toolResultTokens += estimateMessageTokens(message)
    else assistantTokens += estimateMessageTokens(message)
  }
  const systemTokens = system.reduce((total, line) => total + line.tokens, 0)
  const toolsTokens = tools.reduce((total, line) => total + line.tokens, 0)
  const messagesTokens = userTokens + assistantTokens + toolResultTokens
  return {
    system,
    systemTokens,
    tools,
    toolsTokens,
    userTokens,
    assistantTokens,
    toolResultTokens,
    messagesTokens,
    total: systemTokens + toolsTokens + messagesTokens,
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return '[unserializable]'
  }
}

function positiveInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}
