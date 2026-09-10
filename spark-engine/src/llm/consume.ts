import type { AssistantMessage, Usage } from '../events/schema.js'
import { KernelError } from '../kernel/errors.js'
import type { LlmDelta } from './types.js'

export interface ConsumedLlmResponse {
  readonly message: AssistantMessage
  readonly usage: Usage
  /** Wall-clock ms of this LLM call (request send → stream end); 0 when unreported. */
  readonly llmMs: number
  /** Time to first content token of this call; 0 when unreported. */
  readonly ttftMs: number
}

export async function consumeLlmStream(
  stream: AsyncIterable<LlmDelta>,
  onDelta?: (delta: LlmDelta) => Promise<void> | void,
): Promise<ConsumedLlmResponse> {
  let text = ''
  let thinking = ''
  let sawDone = false
  let continuation: AssistantMessage['continuation']
  const toolCalls: AssistantMessage['toolCalls'] = []
  const callIds = new Set<string>()
  let usage: Usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
  let llmMs = 0
  let ttftMs = 0

  for await (const delta of stream) {
    await onDelta?.(delta)
    switch (delta.type) {
      case 'text':
        text += delta.text
        break
      case 'thinking':
        thinking += delta.text
        break
      case 'tool_call':
        if (callIds.has(delta.callId)) {
          throw new KernelError(
            'llm.duplicate_tool_call',
            `Duplicate tool call id: ${delta.callId}`,
          )
        }
        callIds.add(delta.callId)
        toolCalls.push({ callId: delta.callId, name: delta.name, args: delta.args })
        break
      case 'usage':
        usage = {
          inputTokens: delta.inputTokens,
          outputTokens: delta.outputTokens,
          cacheReadTokens: delta.cacheReadTokens ?? 0,
          cacheWriteTokens: delta.cacheWriteTokens ?? 0,
          reasoningTokens: delta.reasoningTokens ?? 0,
        }
        llmMs = delta.callDurationMs ?? 0
        ttftMs = delta.ttftMs ?? 0
        break
      case 'continuation':
        if (continuation) {
          throw new KernelError(
            'llm.duplicate_continuation',
            'Model stream emitted more than one continuation state',
          )
        }
        continuation = structuredClone(delta.continuation)
        break
      case 'done':
        sawDone = true
        break
      case 'heartbeat':
        break
      case 'retry':
        if (delta.resetOutput) {
          text = ''
          thinking = ''
          toolCalls.length = 0
          callIds.clear()
          continuation = undefined
          usage = emptyUsage()
          llmMs = 0
          ttftMs = 0
          sawDone = false
        }
        break
    }
  }

  if (!sawDone) throw new KernelError('llm.incomplete_stream', 'Model stream ended without done')
  if (!text && toolCalls.length === 0) {
    throw new KernelError(
      thinking ? 'llm.no_final_text' : 'llm.empty_response',
      thinking
        ? 'Model returned reasoning without a final answer or tool call'
        : 'Model returned an empty response',
      { retryable: true },
    )
  }
  return {
    message: {
      ...(text ? { text } : {}),
      ...(thinking ? { thinking } : {}),
      ...(continuation ? { continuation } : {}),
      toolCalls,
    },
    usage,
    llmMs,
    ttftMs,
  }
}

function emptyUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  }
}
