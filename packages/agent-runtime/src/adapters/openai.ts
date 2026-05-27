import OpenAI from 'openai'
import type {
  ChatCompletionChunk,
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'
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
import type { ChatMessage, ChatParams, IModelAdapter, ToolDefinition } from './types.js'

const DEFAULT_MAX_TOKENS = 4096

interface OpenAICompatibleOptions {
  provider: string
  defaultBaseURL?: string
  mapReasoningContent?: boolean
}

interface AccumulatedToolCall {
  id?: string
  name?: string
  arguments: string
}

export class OpenAIAdapter implements IModelAdapter {
  readonly provider = 'openai'

  async *streamChat(
    params: ChatParams,
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentEvent> {
    yield* streamOpenAICompatible(params, sessionId, turnId, signal, { provider: this.provider })
  }
}

export async function* streamOpenAICompatible(
  params: ChatParams,
  sessionId: string,
  turnId: string,
  signal: AbortSignal | undefined,
  options: OpenAICompatibleOptions,
): AsyncGenerator<AgentEvent> {
  const base = { sessionId, turnId }
  const providerBase = { ...base, provider: options.provider, model: params.model }
  const client = new OpenAI({
    apiKey: params.apiKey,
    ...(params.apiEndpoint === undefined && options.defaultBaseURL === undefined
      ? {}
      : { baseURL: params.apiEndpoint ?? options.defaultBaseURL }),
  })

  let completeText = ''
  const toolCalls = new Map<number, AccumulatedToolCall>()
  const emittedToolCalls = new Set<number>()

  try {
    const stream = await client.chat.completions.create(
      {
        model: params.model,
        messages: toOpenAIMessages(params),
        stream: true,
        stream_options: { include_usage: true },
        ...(params.maxTokens === undefined ? { max_completion_tokens: DEFAULT_MAX_TOKENS } : { max_completion_tokens: params.maxTokens }),
        ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
        ...(params.reasoningEffort === undefined ? {} : { reasoning_effort: toOpenAIReasoningEffort(params.reasoningEffort) }),
        ...(params.tools === undefined || params.tools.length === 0 ? {} : { tools: params.tools.map(toOpenAITool) }),
      } as Parameters<typeof client.chat.completions.create>[0],
      signal === undefined ? undefined : { signal },
    )

    for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
      if (signal?.aborted) {
        yield agentError(base, 'ABORTED', 'Model stream was aborted', false)
        return
      }

      const events = mapOpenAIChunk(
        chunk,
        providerBase,
        toolCalls,
        emittedToolCalls,
        options.mapReasoningContent ?? false,
      )

      for (const event of events) {
        if (event.type === 'assistant_message' && event.mode === 'delta') {
          completeText += event.content
        }
        yield event
      }
    }

    for (const event of flushToolCalls(base, toolCalls, emittedToolCalls)) {
      yield event
    }

    yield assistantComplete(providerBase, completeText)
  } catch (error) {
    yield errorEventFromUnknown(base, error)
  }
}

function mapOpenAIChunk(
  chunk: ChatCompletionChunk,
  base: { sessionId: string; turnId: string; provider: string; model: string },
  toolCalls: Map<number, AccumulatedToolCall>,
  emittedToolCalls: Set<number>,
  mapReasoningContent: boolean,
): AgentEvent[] {
  const events: AgentEvent[] = []

  if (chunk.usage !== null && chunk.usage !== undefined) {
    events.push(
      usageUpdate(
        base,
        chunk.usage.prompt_tokens,
        chunk.usage.completion_tokens,
        getCachedTokens(chunk.usage),
      ),
    )
  }

  for (const choice of chunk.choices) {
    const reasoningContent = mapReasoningContent
      ? getReasoningContent(choice.delta)
      : undefined

    if (reasoningContent !== undefined && reasoningContent.length > 0) {
      events.push(thinkingDelta(base, reasoningContent))
    }

    if (choice.delta.content !== null && choice.delta.content !== undefined) {
      events.push(assistantDelta(base, choice.delta.content))
    }

    for (const toolCallDelta of choice.delta.tool_calls ?? []) {
      const current = toolCalls.get(toolCallDelta.index) ?? { arguments: '' }
      if (toolCallDelta.id !== undefined) {
        current.id = toolCallDelta.id
      }
      if (toolCallDelta.function?.name !== undefined) {
        current.name = `${current.name ?? ''}${toolCallDelta.function.name}`
      }
      if (toolCallDelta.function?.arguments !== undefined) {
        current.arguments += toolCallDelta.function.arguments
      }
      toolCalls.set(toolCallDelta.index, current)
    }

    if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call') {
      events.push(...flushToolCalls(base, toolCalls, emittedToolCalls))
    }
  }

  return events
}

function flushToolCalls(
  base: { sessionId: string; turnId: string },
  toolCalls: Map<number, AccumulatedToolCall>,
  emittedToolCalls: Set<number>,
): AgentEvent[] {
  const events: AgentEvent[] = []

  for (const [index, call] of [...toolCalls.entries()].sort(([left], [right]) => left - right)) {
    if (emittedToolCalls.has(index) || call.name === undefined) {
      continue
    }

    events.push(
      toolCall(
        base,
        call.id ?? `tool-call-${index}`,
        call.name,
        parseToolInput(call.arguments),
      ),
    )
    emittedToolCalls.add(index)
  }

  return events
}

function toOpenAIMessages(params: ChatParams): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = []

  if (params.systemPrompt !== undefined) {
    messages.push({ role: 'system', content: params.systemPrompt })
  }

  for (const message of params.messages) {
    if (message.role === 'system') {
      messages.push({ role: 'system', content: contentToText(message.content) })
      continue
    }

    if (typeof message.content === 'string') {
      messages.push({ role: message.role, content: message.content })
      continue
    }

    const toolUseBlocks = message.content.filter((block) => block.type === 'tool_use')
    const toolResultBlocks = message.content.filter((block) => block.type === 'tool_result')
    const textBlocks = message.content.filter((block) => block.type === 'text')
    const imageBlocks = message.content.filter((block) => block.type === 'image')
    const text = contentToText(textBlocks)

    if (message.role === 'assistant' && toolUseBlocks.length > 0) {
      messages.push({
        role: 'assistant',
        content: text.length > 0 ? text : null,
        tool_calls: toolUseBlocks.map((block) => ({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        })),
      })
    } else if (imageBlocks.length > 0 && message.role === 'user') {
      // User multi-modal turn: combine text + image parts into a content array.
      const parts: ChatCompletionContentPart[] = []
      if (text.length > 0) parts.push({ type: 'text', text })
      for (const img of imageBlocks) {
        const url = img.source.kind === 'url'
          ? img.source.url
          : `data:${img.source.mediaType};base64,${img.source.data}`
        parts.push({ type: 'image_url', image_url: { url } })
      }
      messages.push({ role: 'user', content: parts })
    } else if (text.length > 0) {
      messages.push({ role: message.role, content: text })
    }

    for (const block of toolResultBlocks) {
      messages.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: block.content,
      })
    }
  }

  return messages
}

function toOpenAITool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }
}

function contentToText(content: ChatMessage['content']): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function getReasoningContent(delta: unknown): string | undefined {
  if (typeof delta !== 'object' || delta === null) {
    return undefined
  }
  const value = (delta as { reasoning_content?: unknown }).reasoning_content
  return typeof value === 'string' ? value : undefined
}

function toOpenAIReasoningEffort(effort: NonNullable<ChatParams['reasoningEffort']>): 'low' | 'medium' | 'high' {
  if (effort === 'xhigh') return 'high'
  return effort
}

function getCachedTokens(usage: ChatCompletionChunk['usage']): number | undefined {
  if (usage === null || usage === undefined) {
    return undefined
  }

  const promptDetails = (usage as { prompt_tokens_details?: { cached_tokens?: unknown } }).prompt_tokens_details
  return typeof promptDetails?.cached_tokens === 'number' ? promptDetails.cached_tokens : undefined
}
