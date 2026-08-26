export interface SystemSection {
  readonly id: string
  readonly content: string
  readonly stability: 'stable' | 'volatile'
}

export interface IrUserMessage {
  readonly role: 'user'
  readonly content: string
  readonly sourceSeqs: readonly number[]
}

export interface IrAssistantMessage {
  readonly role: 'assistant'
  readonly content: string
  readonly thinking?: string
  readonly toolCalls: readonly IrToolCall[]
  readonly continuation?: ProviderContinuation
  readonly sourceSeqs: readonly number[]
}

export interface IrToolCall {
  readonly callId: string
  readonly name: string
  readonly args: unknown
}

export interface IrToolResultMessage {
  readonly role: 'tool_result'
  readonly callId: string
  readonly tool: string
  readonly ok: boolean
  readonly content: string
  readonly sourceSeqs: readonly number[]
}

export type IrMessage = IrUserMessage | IrAssistantMessage | IrToolResultMessage

export interface IrToolDefinition {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>> | boolean
}

export type ThinkingConfig =
  | {
      readonly type: 'adaptive'
      readonly display?: 'omitted' | 'summarized'
      /** Provider-neutral reasoning-effort hint for adaptive-thinking models. */
      readonly effort?: 'low' | 'medium' | 'high'
    }
  | { readonly type: 'enabled'; readonly budgetTokens: number }
  | { readonly type: 'disabled' }

/**
 * User-facing reasoning-effort levels shared by the CLI flag, the TUI command,
 * and the LLM request mapping. `off` disables thinking entirely.
 */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high'

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return value === 'off' || value === 'low' || value === 'medium' || value === 'high'
}

/** Canonical token budgets for the enabled-thinking protocols (Anthropic). */
export const EFFORT_BUDGET_TOKENS: Readonly<Record<Exclude<ReasoningEffort, 'off'>, number>> = {
  low: 4_096,
  medium: 12_288,
  high: 32_768,
}

/**
 * Maps a user-selected effort level onto the provider-neutral thinking config:
 * explicit off, or a concrete token budget that each protocol translates into
 * its native shape (Anthropic budget_tokens, OpenAI reasoning.effort).
 */
export function thinkingConfigFor(effort: ReasoningEffort): ThinkingConfig {
  if (effort === 'off') return { type: 'disabled' }
  return { type: 'enabled', budgetTokens: EFFORT_BUDGET_TOKENS[effort] }
}

export interface ProviderContinuation {
  readonly protocol: 'anthropic-messages' | 'openai-responses'
  readonly data: unknown
}

export interface LlmRequest {
  readonly system: readonly SystemSection[]
  readonly messages: readonly IrMessage[]
  readonly tools: readonly IrToolDefinition[]
  readonly thinking?: ThinkingConfig
  readonly cacheBreakpoints?: readonly number[]
  readonly maxTokens: number
  readonly stopSequences?: readonly string[]
  readonly metadata: Readonly<Record<string, string>>
}

export type LlmDelta =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'thinking'; readonly text: string }
  | {
      readonly type: 'tool_call'
      readonly callId: string
      readonly name: string
      readonly args: unknown
    }
  | {
      readonly type: 'usage'
      readonly inputTokens: number
      readonly outputTokens: number
      readonly cacheReadTokens?: number
      readonly cacheWriteTokens?: number
    }
  | { readonly type: 'continuation'; readonly continuation: ProviderContinuation }
  | { readonly type: 'heartbeat' }
  | { readonly type: 'done' }

export interface ModelCapabilities {
  readonly tools: boolean
  readonly parallelToolCalls: boolean
  readonly thinking: boolean
  readonly promptCaching: boolean
  readonly assistantPrefill: boolean
  readonly images: boolean
}
