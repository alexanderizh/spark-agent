import Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlockParam,
  MessageParam,
  MessageStreamEvent,
  TextBlockParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages'
import type { AgentEvent } from '@spark/protocol'

import {
  agentError,
  assistantComplete,
  assistantDelta,
  errorEventFromUnknown,
  parseToolInput,
  thinkingComplete,
  thinkingDelta,
  toolCall,
  usageUpdate,
} from './events.js'
import type { ChatContentBlock, ChatMessage, ChatParams, IModelAdapter, ToolDefinition } from './types.js'

const DEFAULT_MAX_TOKENS = 4096

interface PendingToolUse {
  id: string
  name: string
  input: unknown
  inputJson: string
}

export class AnthropicAdapter implements IModelAdapter {
  readonly provider = 'anthropic'

  async *streamChat(
    params: ChatParams,
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    const base = { sessionId, turnId }
    const providerBase = { ...base, provider: this.provider, model: params.model }
    const client = new Anthropic({
      apiKey: params.apiKey,
      ...(params.apiEndpoint === undefined ? {} : { baseURL: normalizeAnthropicBaseURL(params.apiEndpoint) }),
    })

    let completeText = ''
    let completeThinking = ''
    const pendingTools = new Map<number, PendingToolUse>()

    try {
      const maxTokens = getAnthropicMaxTokens(params)
      const stream = client.messages.stream(
        {
          model: params.model,
          max_tokens: maxTokens,
          messages: toAnthropicMessages(params.messages),
          ...anthropicSystemPrompt(params),
          ...anthropicThinking(params, maxTokens),
          ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
          ...(params.tools === undefined || params.tools.length === 0
            ? {}
            : { tools: toAnthropicTools(params.tools) }),
        },
        signal === undefined ? undefined : { signal },
      )

      for await (const event of stream) {
        if (signal?.aborted) {
          yield agentError(base, 'ABORTED', 'Model stream was aborted', false)
          return
        }

        const mapped = mapAnthropicEvent(
          event,
          providerBase,
          completeText,
          completeThinking,
          pendingTools,
        )
        completeText = mapped.completeText
        completeThinking = mapped.completeThinking

        for (const output of mapped.events) {
          yield output
        }
      }
    } catch (error) {
      yield errorEventFromUnknown(base, error)
    }
  }
}

function normalizeAnthropicBaseURL(apiEndpoint: string): string {
  return apiEndpoint
    .replace(/\/+$/, '')
    .replace(/\/v1\/messages$/, '')
    .replace(/\/v1$/, '')
}

function mapAnthropicEvent(
  event: MessageStreamEvent,
  base: { sessionId: string; turnId: string; provider: string; model: string },
  completeText: string,
  completeThinking: string,
  pendingTools: Map<number, PendingToolUse>,
): { events: AgentEvent[]; completeText: string; completeThinking: string } {
  switch (event.type) {
    case 'message_start': {
      const usage = event.message.usage
      return {
        events: [
          usageUpdate(
            base,
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_input_tokens ?? undefined,
          ),
        ],
        completeText,
        completeThinking,
      }
    }

    case 'content_block_start': {
      const block = event.content_block
      if (block.type === 'tool_use') {
        pendingTools.set(event.index, {
          id: block.id,
          name: block.name,
          input: block.input,
          inputJson: '',
        })
        return {
          events: [],
          completeText,
          completeThinking,
        }
      }

      if (block.type === 'thinking' && block.thinking.length > 0) {
        return {
          events: [thinkingDelta(base, block.thinking)],
          completeText,
          completeThinking: completeThinking + block.thinking,
        }
      }

      return { events: [], completeText, completeThinking }
    }

    case 'content_block_delta': {
      if (event.delta.type === 'text_delta') {
        return {
          events: [assistantDelta(base, event.delta.text)],
          completeText: completeText + event.delta.text,
          completeThinking,
        }
      }

      if (event.delta.type === 'thinking_delta') {
        return {
          events: [thinkingDelta(base, event.delta.thinking)],
          completeText,
          completeThinking: completeThinking + event.delta.thinking,
        }
      }

      if (event.delta.type === 'input_json_delta') {
        const pendingTool = pendingTools.get(event.index)
        if (pendingTool !== undefined) {
          pendingTool.inputJson += event.delta.partial_json
        }
        return { events: [], completeText, completeThinking }
      }

      return { events: [], completeText, completeThinking }
    }

    case 'content_block_stop': {
      const pendingTool = pendingTools.get(event.index)
      if (pendingTool === undefined) {
        return { events: [], completeText, completeThinking }
      }

      pendingTools.delete(event.index)
      return {
        events: [
          toolCall(
            base,
            pendingTool.id,
            pendingTool.name,
            parseToolInput(pendingTool.inputJson.length > 0 ? pendingTool.inputJson : pendingTool.input),
          ),
        ],
        completeText,
        completeThinking,
      }
    }

    case 'message_delta':
      return {
        events: [
          usageUpdate(
            base,
            0,
            event.usage.output_tokens,
            event.usage.cache_read_input_tokens ?? undefined,
          ),
        ],
        completeText,
        completeThinking,
      }

    case 'message_stop': {
      const events: AgentEvent[] = []
      if (completeThinking.length > 0) {
        events.push(thinkingComplete(base, completeThinking))
      }
      events.push(assistantComplete(base, completeText))
      return { events, completeText, completeThinking }
    }

    default:
      return { events: [], completeText, completeThinking }
  }
}

/**
 * Convert ChatMessage[] → MessageParam[] and insert a prompt-cache breakpoint
 * on the second-to-last user message's last content block.
 *
 * Why second-to-last user (not the last): the last user message is what we're
 * actually paying to send NEW each turn — caching it would only help the NEXT
 * turn, but by then we've appended another user message and the cache point
 * has moved anyway. Caching at "everything before the current user input"
 * means each turn's stable prefix (system + tools + history) reuses cache.
 *
 * Anthropic allows at most 4 cache breakpoints per request. We use up to 3:
 * tools[last], system, messages[2nd-to-last user]. That leaves headroom.
 */
function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
  const result: MessageParam[] = []
  for (const message of messages) {
    if (message.role === 'system') continue
    result.push({ role: message.role, content: toAnthropicContent(message.content) })
  }

  // Find second-to-last user message and attach cache_control to its final block.
  const userIndices = result
    .map((m, i) => (m.role === 'user' ? i : -1))
    .filter((i) => i >= 0)
  if (userIndices.length >= 2) {
    const breakpointMsgIdx = userIndices[userIndices.length - 2]!
    const msg = result[breakpointMsgIdx]!
    if (typeof msg.content !== 'string' && msg.content.length > 0) {
      const lastBlock = msg.content[msg.content.length - 1]!
      // Only text/tool_result blocks support cache_control; tool_use rarely the last.
      if (lastBlock.type === 'text' || lastBlock.type === 'tool_result' || lastBlock.type === 'tool_use') {
        ;(lastBlock as { cache_control?: { type: 'ephemeral' } }).cache_control = { type: 'ephemeral' }
      }
    } else if (typeof msg.content === 'string' && msg.content.length > 0) {
      // Promote to block form so we can attach cache_control.
      result[breakpointMsgIdx] = {
        role: msg.role,
        content: [{ type: 'text', text: msg.content, cache_control: { type: 'ephemeral' } }],
      }
    }
  }

  return result
}

/**
 * Build the `system` parameter as a TextBlockParam[] so we can attach
 * cache_control to it. Caching the system prompt (which is large and stable
 * across turns) is the single biggest savings for an interactive agent.
 *
 * Only cache when the system prompt is large enough to be worth it
 * (Anthropic billing minimum is ~1024 tokens for Sonnet/Opus). We use
 * a coarse char-count proxy (≈4 chars/token) to avoid wasted breakpoints.
 */
function anthropicSystemPrompt(params: ChatParams): { system: TextBlockParam[] } | Record<string, never> {
  const systemMessages = params.messages
    .filter((message) => message.role === 'system')
    .map((message) => contentToText(message.content))
  const system = [params.systemPrompt, ...systemMessages]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join('\n\n')

  if (system.length === 0) return {}

  const block: TextBlockParam = { type: 'text', text: system }
  // ~4 chars per token; Sonnet/Opus require ≥1024 tokens for caching.
  if (system.length >= 4096) {
    (block as { cache_control?: { type: 'ephemeral' } }).cache_control = { type: 'ephemeral' }
  }
  return { system: [block] }
}

function getAnthropicMaxTokens(params: ChatParams): number {
  const budget = getAnthropicThinkingBudget(params.reasoningEffort)
  const requested = params.maxTokens ?? DEFAULT_MAX_TOKENS
  return budget === undefined ? requested : Math.max(requested, budget + 1024)
}

function anthropicThinking(
  params: ChatParams,
  maxTokens: number,
): { thinking: { type: 'enabled'; budget_tokens: number } } | Record<string, never> {
  const budget = getAnthropicThinkingBudget(params.reasoningEffort)
  if (budget === undefined) return {}
  return { thinking: { type: 'enabled', budget_tokens: Math.min(budget, maxTokens - 1) } }
}

function getAnthropicThinkingBudget(effort: ChatParams['reasoningEffort']): number | undefined {
  switch (effort) {
    case 'low': return 1024
    case 'medium': return 4096
    case 'high': return 8192
    case 'xhigh': return 16384
    default: return undefined
  }
}

function toAnthropicContent(content: ChatMessage['content']): string | ContentBlockParam[] {
  if (typeof content === 'string') {
    return content
  }

  return content.map((block) => {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text }
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        }
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: block.content,
        }
      case 'image':
        return block.source.kind === 'base64'
          ? {
              type: 'image',
              source: { type: 'base64', media_type: block.source.mediaType, data: block.source.data },
            }
          : {
              type: 'image',
              source: { type: 'url', url: block.source.url },
            }
    }
  }) as ContentBlockParam[]
}

function contentToText(content: string | ChatContentBlock[]): string {
  if (typeof content === 'string') {
    return content
  }
  return content
    .map((block) => {
      if (block.type === 'text') return block.text
      if (block.type === 'tool_use') return JSON.stringify({ tool: block.name, input: block.input })
      if (block.type === 'tool_result') return block.content
      if (block.type === 'image') return '[image]'
      return ''
    })
    .join('\n')
}

function toAnthropicTool(tool: ToolDefinition): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Tool.InputSchema,
  }
}

/**
 * Convert ToolDefinition[] and attach a cache breakpoint on the LAST tool
 * (caching `system + tools` block as a whole). The tool list is large and
 * fully stable across turns, so this is a "free" cache hit.
 */
function toAnthropicTools(tools: ToolDefinition[]): Tool[] {
  const out = tools.map(toAnthropicTool)
  if (out.length > 0) {
    ;(out[out.length - 1] as { cache_control?: { type: 'ephemeral' } }).cache_control = { type: 'ephemeral' }
  }
  return out
}
