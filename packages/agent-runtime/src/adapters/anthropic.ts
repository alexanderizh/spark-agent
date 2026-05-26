import Anthropic from '@anthropic-ai/sdk'
import type {
  ContentBlockParam,
  MessageParam,
  MessageStreamEvent,
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
      const stream = client.messages.stream(
        {
          model: params.model,
          max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
          messages: toAnthropicMessages(params.messages),
          ...anthropicSystemPrompt(params),
          ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
          ...(params.tools === undefined || params.tools.length === 0
            ? {}
            : { tools: params.tools.map(toAnthropicTool) }),
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

function toAnthropicMessages(messages: ChatMessage[]): MessageParam[] {
  const result: MessageParam[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      continue
    }

    const content = toAnthropicContent(message.content)

    result.push({
      role: message.role,
      content,
    })
  }

  return result
}

function anthropicSystemPrompt(params: ChatParams): { system: string } | Record<string, never> {
  const systemMessages = params.messages
    .filter((message) => message.role === 'system')
    .map((message) => contentToText(message.content))
  const system = [params.systemPrompt, ...systemMessages]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join('\n\n')

  return system.length > 0 ? { system } : {}
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
      return block.content
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
