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
  for (const message of options.messages) {
    if (message.role === 'user' || message.role === 'tool_result') {
      total += estimateTextTokens(message.content) + 12
    } else {
      total += estimateTextTokens(message.content) + estimateTextTokens(message.thinking) + 16
      for (const call of message.toolCalls) {
        total += estimateTextTokens(call.name) + estimateTextTokens(safeJson(call.args)) + 16
      }
    }
  }
  for (const tool of options.tools) {
    total += estimateTextTokens(tool.name) + estimateTextTokens(tool.description)
    total += estimateTextTokens(safeJson(tool.inputSchema)) + 32
  }
  return total
}

function estimateTextTokens(value: string | undefined): number {
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
