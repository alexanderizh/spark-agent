import { randomUUID } from 'node:crypto'

import type {
  AgentErrorEvent,
  AgentThinkingEvent,
  AssistantMessageEvent,
  ProviderId,
  ToolCallEvent,
  UsageUpdateEvent,
} from '@spark/protocol'

interface BaseEventParams {
  sessionId: string
  turnId: string
}

interface ProviderEventParams extends BaseEventParams {
  provider: ProviderId
  model: string
}

function baseEvent({ sessionId, turnId }: BaseEventParams) {
  return {
    id: randomUUID(),
    sessionId,
    turnId,
    timestamp: new Date().toISOString(),
    seq: 0,
  }
}

export function assistantDelta(
  params: ProviderEventParams,
  content: string,
): AssistantMessageEvent {
  return {
    ...baseEvent(params),
    type: 'assistant_message',
    mode: 'delta',
    content,
    provider: params.provider,
    isFinal: false,
  }
}

export function assistantComplete(
  params: ProviderEventParams,
  content: string,
): AssistantMessageEvent {
  return {
    ...baseEvent(params),
    type: 'assistant_message',
    mode: 'complete',
    content,
    provider: params.provider,
    isFinal: true,
  }
}

export function toolCall(
  params: BaseEventParams,
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): ToolCallEvent {
  return {
    ...baseEvent(params),
    type: 'tool_call',
    toolCallId,
    toolName,
    toolInput,
    source: 'builtin',
  }
}

export function thinkingDelta(
  params: BaseEventParams,
  content: string,
): AgentThinkingEvent {
  return {
    ...baseEvent(params),
    type: 'agent_thinking',
    mode: 'delta',
    content,
  }
}

export function thinkingComplete(
  params: BaseEventParams,
  content: string,
): AgentThinkingEvent {
  return {
    ...baseEvent(params),
    type: 'agent_thinking',
    mode: 'complete',
    content,
  }
}

export function usageUpdate(
  params: ProviderEventParams,
  inputTokens: number,
  outputTokens: number,
  cacheHitTokens?: number,
): UsageUpdateEvent {
  return {
    ...baseEvent(params),
    type: 'usage_update',
    provider: params.provider,
    model: params.model,
    inputTokens,
    outputTokens,
    ...(cacheHitTokens === undefined ? {} : { cacheHitTokens }),
  }
}

export function agentError(
  params: BaseEventParams,
  code: string,
  message: string,
  retryable: boolean,
  rawError?: string,
): AgentErrorEvent {
  return {
    ...baseEvent(params),
    type: 'agent_error',
    code,
    message,
    retryable,
    ...(rawError === undefined ? {} : { rawError }),
  }
}

export function errorEventFromUnknown(
  params: BaseEventParams,
  error: unknown,
): AgentErrorEvent {
  if (isAbortError(error)) {
    return agentError(params, 'ABORTED', 'Model stream was aborted', false, toRawError(error))
  }

  return agentError(
    params,
    'MODEL_STREAM_ERROR',
    error instanceof Error ? error.message : 'Model stream failed',
    true,
    toRawError(error),
  )
}

export function parseToolInput(input: string | unknown): Record<string, unknown> {
  if (typeof input !== 'string') {
    return isRecord(input) ? input : { value: input }
  }

  if (input.trim() === '') {
    return {}
  }

  try {
    const parsed: unknown = JSON.parse(input)
    return isRecord(parsed) ? parsed : { value: parsed }
  } catch {
    return { raw: input }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.name === 'APIUserAbortError'
  }
  return false
}

function toRawError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  return String(error)
}
