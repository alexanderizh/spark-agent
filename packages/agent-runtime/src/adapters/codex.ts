import OpenAI from 'openai'
import type { AgentEvent } from '@spark/protocol'

import {
  agentError,
  assistantComplete,
  assistantDelta,
  errorEventFromUnknown,
  parseToolInput,
  thinkingDelta,
  toolCall,
  usageUpdate,
} from './events.js'
import type { ChatContentBlock, ChatMessage, ChatParams, IModelAdapter, ToolDefinition } from './types.js'

const DEFAULT_MAX_TOKENS = 4096

/**
 * CodexAdapter — uses the OpenAI **Responses API** (`client.responses.stream`).
 *
 * Why a separate adapter from OpenAIAdapter:
 *   - Responses API has its own input / output / event shape (not chat.completions).
 *   - Codex-tuned models (gpt-5-codex etc.) expect Responses-style reasoning_items
 *     and natively understand `apply_patch` as a built-in tool.
 *   - Caching, `previous_response_id` chaining, and structured reasoning persistence
 *     are only available here.
 *
 * Selection: provider config `codexApiKind === 'responses'` routes through this
 * adapter via adapter-factory. Other OpenAI-compatible backends keep using
 * `OpenAIAdapter` (chat.completions).
 *
 * NOTE: This is a minimal mapping good enough to drive an end-to-end agent loop.
 * It handles text deltas, reasoning summaries, function tool calls, and usage.
 * Advanced Responses features (apply_patch built-in, web_search, file_search,
 * MCP, image generation, code interpreter, computer-use) are deferred — calls
 * to those will simply not be emitted as `tool_call` events yet.
 */
export class CodexAdapter implements IModelAdapter {
  readonly provider = 'codex'

  async *streamChat(
    params: ChatParams,
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const base = { sessionId, turnId }
    const providerBase = { ...base, provider: this.provider, model: params.model }
    const client = new OpenAI({
      apiKey: params.apiKey,
      ...(params.apiEndpoint === undefined ? {} : { baseURL: params.apiEndpoint }),
    })

    let completeText = ''

    try {
      const requestBody = {
        model: params.model,
        input: toResponsesInput(params.messages),
        ...(params.systemPrompt === undefined ? {} : { instructions: params.systemPrompt }),
        ...(params.tools === undefined || params.tools.length === 0 ? {} : { tools: params.tools.map(toResponsesTool) }),
        ...(params.maxTokens === undefined ? { max_output_tokens: DEFAULT_MAX_TOKENS } : { max_output_tokens: params.maxTokens }),
        ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
        ...(params.reasoningEffort === undefined
          ? {}
          : { reasoning: { effort: toResponsesReasoningEffort(params.reasoningEffort) } }),
      }
      const stream = client.responses.stream(
        requestBody as unknown as Parameters<typeof client.responses.stream>[0],
        signal === undefined ? undefined : { signal },
      )

      for await (const event of stream as AsyncIterable<{ type: string; [key: string]: unknown }>) {
        if (signal?.aborted) {
          yield agentError(base, 'ABORTED', 'Model stream was aborted', false)
          return
        }

        // Responses API streams `response.*.delta` / `response.*.done` events.
        // We map the subset relevant to driving an agent loop.
        switch (event.type) {
          case 'response.output_text.delta': {
            const delta = String((event as { delta?: unknown }).delta ?? '')
            if (delta.length > 0) {
              completeText += delta
              yield assistantDelta(providerBase, delta)
            }
            break
          }
          case 'response.reasoning_summary_text.delta': {
            const delta = String((event as { delta?: unknown }).delta ?? '')
            if (delta.length > 0) yield thinkingDelta(providerBase, delta)
            break
          }
          case 'response.output_item.done': {
            const item = (event as { item?: { type?: string; id?: string; name?: string; arguments?: string; call_id?: string } }).item
            if (item?.type === 'function_call' && typeof item.name === 'string') {
              yield toolCall(
                providerBase,
                item.call_id ?? item.id ?? `tool-${Date.now()}`,
                item.name,
                parseToolInput(item.arguments ?? '{}'),
              )
            }
            break
          }
          case 'response.completed': {
            const usage = (event as { response?: { usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } } }).response?.usage
            if (usage) {
              yield usageUpdate(
                providerBase,
                usage.input_tokens ?? 0,
                usage.output_tokens ?? 0,
                usage.input_tokens_details?.cached_tokens,
              )
            }
            yield assistantComplete(providerBase, completeText)
            return
          }
          case 'response.error':
          case 'error': {
            const message = String((event as { error?: { message?: unknown }; message?: unknown }).error?.message ?? (event as { message?: unknown }).message ?? 'Unknown Responses API error')
            yield agentError(base, 'RUNTIME_ERROR', message, true)
            return
          }
          default:
            // Many other event types exist (response.created, .in_progress,
            // .output_item.added, .content_part.added, etc.) — they're informational
            // and don't drive agent loop decisions, so we ignore them.
            break
        }
      }

      // Stream ended without a `response.completed` event — emit a final complete just in case.
      yield assistantComplete(providerBase, completeText)
    } catch (error) {
      yield errorEventFromUnknown(base, error)
    }
  }
}

/**
 * Convert ChatMessage[] → Responses API input items.
 *
 * Responses API input is a sequence of items:
 *   - { type: 'message', role, content: [{ type: 'input_text' | 'output_text', text }] }
 *   - { type: 'function_call', call_id, name, arguments }
 *   - { type: 'function_call_output', call_id, output }
 *
 * For now we map:
 *   - system messages: dropped (handled via `instructions`)
 *   - user/assistant text/image: input message
 *   - assistant tool_use: function_call item
 *   - tool_result: function_call_output item
 */
function toResponsesInput(messages: ChatMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const msg of messages) {
    if (msg.role === 'system') continue
    if (typeof msg.content === 'string') {
      out.push({
        type: 'message',
        role: msg.role,
        content: [{ type: msg.role === 'assistant' ? 'output_text' : 'input_text', text: msg.content }],
      })
      continue
    }
    const parts: Array<Record<string, unknown>> = []
    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          parts.push({ type: msg.role === 'assistant' ? 'output_text' : 'input_text', text: block.text })
          break
        case 'image':
          parts.push({
            type: 'input_image',
            image_url: block.source.kind === 'url'
              ? block.source.url
              : `data:${block.source.mediaType};base64,${block.source.data}`,
          })
          break
        case 'tool_use':
          // Flush any accumulated text parts as a message first.
          if (parts.length > 0) {
            out.push({ type: 'message', role: msg.role, content: parts.splice(0) })
          }
          out.push({
            type: 'function_call',
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          })
          break
        case 'tool_result':
          if (parts.length > 0) {
            out.push({ type: 'message', role: msg.role, content: parts.splice(0) })
          }
          out.push({
            type: 'function_call_output',
            call_id: block.tool_use_id,
            output: block.content,
          })
          break
      }
    }
    if (parts.length > 0) {
      out.push({ type: 'message', role: msg.role, content: parts })
    }
  }
  return out
}

function toResponsesTool(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  }
}

function toResponsesReasoningEffort(effort: NonNullable<ChatParams['reasoningEffort']>): 'low' | 'medium' | 'high' {
  if (effort === 'xhigh') return 'high'
  return effort
}

// re-export to silence unused-import lint if any
export type { ChatContentBlock }
