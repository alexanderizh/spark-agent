import { KernelError } from '../../kernel/errors.js'
import { anthropicAuthHeaders } from './auth-headers.js'
import type { LlmCallContext, LlmService } from '../../seams.js'
import { safeDiagnosticText, safeProviderError } from '../error-detail.js'
import { asRecord, numberValue, openSse, stringValue, type FetchLike } from '../http/client.js'
import { clientIdentityHeaders } from '../http/client-identity.js'
import type { IrMessage, LlmDelta, LlmRequest, ProviderContinuation } from '../types.js'

export interface AnthropicMessagesOptions {
  readonly apiKey: string
  readonly model: string
  readonly baseUrl?: string
  readonly version?: string
  readonly fetch?: FetchLike
  readonly promptCaching?: boolean
}

export class AnthropicMessagesService implements LlmService {
  readonly #options: AnthropicMessagesOptions

  constructor(options: AnthropicMessagesOptions) {
    if (!options.apiKey) throw new Error('Anthropic API key is required')
    if (!options.model) throw new Error('Anthropic model is required')
    this.#options = options
  }

  async *stream(request: LlmRequest, context: LlmCallContext): AsyncIterable<LlmDelta> {
    const startedAt = Date.now()
    const opened = await openSse({
      provider: 'anthropic',
      url: messagesEndpoint(this.#options.baseUrl ?? 'https://api.anthropic.com'),
      headers: {
        ...clientIdentityHeaders(request.metadata.sessionId),
        // 第三方 Anthropic 兼容渠道只认 x-api-key 或 Bearer 之一，按端点形态投放。
        ...anthropicAuthHeaders(this.#options.baseUrl, this.#options.apiKey),
        'anthropic-version': this.#options.version ?? '2023-06-01',
      },
      body: toAnthropicRequest(request, this.#options.model, this.#options.promptCaching ?? true),
      signal: context.signal,
      ...(this.#options.fetch ? { fetch: this.#options.fetch } : {}),
    })
    yield* decodeAnthropicEvents(opened.events, opened.requestId, startedAt)
  }
}

/** Block-level cache marker: the only form the Messages API understands. */
const EPHEMERAL_CACHE_CONTROL = { type: 'ephemeral' } as const

export function toAnthropicRequest(
  request: LlmRequest,
  model: string,
  promptCaching: boolean,
): Record<string, unknown> {
  const system: Record<string, unknown>[] = request.system.map((section) => ({
    type: 'text',
    text: section.content,
  }))
  const tools: Record<string, unknown>[] = request.tools.map((tool) => {
    if (typeof tool.inputSchema === 'boolean') {
      throw new KernelError(
        'llm.anthropic.unsupported_tool_schema',
        `Anthropic tool ${tool.name} requires an object JSON Schema`,
      )
    }
    return { name: tool.name, description: tool.description, input_schema: tool.inputSchema }
  })
  const messages = toAnthropicMessages(request.messages)
  if (promptCaching) {
    // Cache prefixes are written at explicit content-block breakpoints. The
    // cache prefix order is tools → system → messages, so three markers cover
    // the whole request: the static tool/system definitions, and one rolling
    // marker on the newest message so the next step hits the full prefix.
    const lastStableSection = lastStableIndex(request.system)
    const stableSystemBlock = system[lastStableSection]
    if (stableSystemBlock !== undefined) {
      system[lastStableSection] = { ...stableSystemBlock, cache_control: EPHEMERAL_CACHE_CONTROL }
    }
    const lastTool = tools.at(-1)
    if (lastTool !== undefined)
      tools[tools.length - 1] = { ...lastTool, cache_control: EPHEMERAL_CACHE_CONTROL }
    markNewestMessage(messages)
  }
  return {
    model,
    max_tokens: request.maxTokens,
    stream: true,
    system,
    messages,
    ...(tools.length === 0 ? {} : { tools }),
    ...(request.stopSequences?.length ? { stop_sequences: request.stopSequences } : {}),
    ...(request.thinking
      ? { thinking: toThinking(request.thinking, request.maxTokens, tools.length > 0) }
      : {}),
  }
}

function lastStableIndex(sections: LlmRequest['system']): number {
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    if (sections[index]?.stability === 'stable') return index
  }
  return -1
}

/**
 * Places the rolling breakpoint on the newest cacheable block. Thinking
 * blocks (replayed verbatim when thinking is enabled) must not carry
 * cache_control, so the marker lands on the newest text/tool block instead.
 */
function markNewestMessage(messages: Record<string, unknown>[]): void {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const content = messages[messageIndex]?.content
    if (!Array.isArray(content)) continue
    const blocks = content as Record<string, unknown>[]
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
      const block = blocks[blockIndex]
      if (!isCacheableBlock(block)) continue
      blocks[blockIndex] = { ...block, cache_control: EPHEMERAL_CACHE_CONTROL }
      return
    }
  }
}

function isCacheableBlock(block: unknown): boolean {
  if (typeof block !== 'object' || block === null) return false
  const type = (block as Record<string, unknown>).type
  return type !== 'thinking' && type !== 'redacted_thinking'
}

function toAnthropicMessages(messages: readonly IrMessage[]): Record<string, unknown>[] {
  const result: { role: 'user' | 'assistant'; content: unknown[] }[] = []
  const append = (role: 'user' | 'assistant', blocks: unknown[]): void => {
    const last = result.at(-1)
    if (last?.role === role) last.content.push(...blocks)
    else result.push({ role, content: [...blocks] })
  }
  for (const message of messages) {
    if (message.role === 'user') {
      append('user', [{ type: 'text', text: message.content }, ...anthropicImageBlocks(message)])
    } else if (message.role === 'tool_result') {
      append('user', [
        {
          type: 'tool_result',
          tool_use_id: message.callId,
          content: message.content,
          ...(message.ok ? {} : { is_error: true }),
        },
        // Images a tool produced ride in the same user turn, right after the
        // tool_result block they belong to.
        ...anthropicImageBlocks(message),
      ])
    } else {
      append('assistant', continuationBlocks(message.continuation) ?? reconstructedBlocks(message))
    }
  }
  return result
}

/**
 * Anthropic takes inline base64 images after the text block, so the model
 * reads the prompt first and then the attached pictures it refers to.
 */
function anthropicImageBlocks(message: {
  readonly imageParts?: readonly { readonly mediaType: string; readonly base64: string }[]
}): Record<string, unknown>[] {
  return (message.imageParts ?? []).map((image) => ({
    type: 'image',
    source: { type: 'base64', media_type: image.mediaType, data: image.base64 },
  }))
}

function continuationBlocks(continuation: ProviderContinuation | undefined): unknown[] | undefined {
  if (continuation?.protocol !== 'anthropic-messages' || !Array.isArray(continuation.data)) {
    return undefined
  }
  const blocks = continuation.data.filter((item) => asRecord(item))
  return blocks.length === continuation.data.length ? structuredClone(blocks) : undefined
}

function reconstructedBlocks(message: Extract<IrMessage, { role: 'assistant' }>): unknown[] {
  const blocks: unknown[] = []
  if (message.content) blocks.push({ type: 'text', text: message.content })
  for (const call of message.toolCalls) {
    blocks.push({ type: 'tool_use', id: call.callId, name: call.name, input: call.args })
  }
  return blocks
}

function toThinking(
  thinking: NonNullable<LlmRequest['thinking']>,
  maxTokens: number,
  hasTools: boolean,
): Record<string, unknown> {
  if (thinking.type === 'enabled') {
    // Anthropic counts thinking and visible answer tokens against the same
    // max_tokens ceiling. Keep a meaningful answer reserve instead of
    // allowing the default `high` budget to leave one token for the answer.
    // The reserve scales down for deliberately tiny caller-provided limits.
    const visibleReserve = hasTools
      ? Math.min(8_192, Math.max(1_024, Math.floor(maxTokens / 3)))
      : Math.min(2_048, Math.max(1, Math.floor(maxTokens / 4)))
    const availableThinking = Math.max(0, maxTokens - visibleReserve)
    // Anthropic's manual budget_tokens has a 1K lower bound. When the model's
    // configured output ceiling cannot fit a valid thinking block plus a
    // visible answer reserve, disable thinking rather than sending a request
    // the provider will reject.
    if (availableThinking < 1_024) return { type: 'disabled' }
    return {
      type: 'enabled',
      budget_tokens: Math.min(thinking.budgetTokens, availableThinking),
    }
  }
  if (thinking.type === 'adaptive') {
    return { type: 'adaptive', ...(thinking.display ? { display: thinking.display } : {}) }
  }
  return { type: 'disabled' }
}

async function* decodeAnthropicEvents(
  events: AsyncIterable<{ readonly data: string }>,
  requestId: string | undefined,
  startedAt: number,
): AsyncIterable<LlmDelta> {
  const blocks = new Map<number, Record<string, unknown>>()
  const partialJson = new Map<number, string>()
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let firstContentAt: number | undefined
  let responseModel: string | undefined
  const emittedTextByIndex = new Map<number, string>()
  let stopped = false

  for await (const event of events) {
    if (event.data === '[DONE]') continue
    const value = parseEvent(event.data, 'anthropic', requestId)
    const type = stringValue(value.type)
    if (type === 'ping') {
      yield { type: 'heartbeat' }
    } else if (type === 'message_start') {
      const message = asRecord(value.message)
      responseModel = stringValue(message?.model)
      const usage = asRecord(message?.usage)
      inputTokens = token(usage?.input_tokens)
      cacheReadTokens = token(usage?.cache_read_input_tokens)
      cacheWriteTokens = cacheCreationTokens(usage?.cache_creation_input_tokens)
    } else if (type === 'content_block_start') {
      const index = indexValue(value.index)
      const block = asRecord(value.content_block)
      if (!block) malformed(type, requestId)
      blocks.set(index, structuredClone(block))
      if (block.type === 'tool_use') partialJson.set(index, '')
    } else if (type === 'content_block_delta') {
      const index = indexValue(value.index)
      const delta = asRecord(value.delta)
      const block = blocks.get(index)
      if (!delta || !block) malformed(type, requestId)
      if (delta.type === 'text_delta') {
        const text = requiredString(delta.text, type, requestId)
        block.text = `${stringValue(block.text) ?? ''}${text}`
        emittedTextByIndex.set(index, `${emittedTextByIndex.get(index) ?? ''}${text}`)
        firstContentAt ??= Date.now()
        yield { type: 'text', text }
      } else if (delta.type === 'thinking_delta') {
        const text = requiredString(delta.thinking, type, requestId)
        block.thinking = `${stringValue(block.thinking) ?? ''}${text}`
        firstContentAt ??= Date.now()
        yield { type: 'thinking', text }
      } else if (delta.type === 'signature_delta') {
        block.signature = `${stringValue(block.signature) ?? ''}${requiredString(delta.signature, type, requestId)}`
      } else if (delta.type === 'input_json_delta') {
        partialJson.set(
          index,
          `${partialJson.get(index) ?? ''}${requiredString(delta.partial_json, type, requestId)}`,
        )
      }
    } else if (type === 'content_block_stop') {
      const index = indexValue(value.index)
      const block = blocks.get(index)
      if (!block) malformed(type, requestId)
      if (block.type === 'tool_use') {
        const json = partialJson.get(index) ?? ''
        const args = json
          ? parseJson(json, 'llm.anthropic.invalid_tool_json', requestId, {
              ...(responseModel ? { responseModel } : {}),
              jsonCharacters: json.length,
            })
          : block.input
        block.input = args
        firstContentAt ??= Date.now()
        yield {
          type: 'tool_call',
          callId: requiredString(block.id, type, requestId),
          name: requiredString(block.name, type, requestId),
          args,
        }
      }
    } else if (type === 'message_delta') {
      const usage = asRecord(value.usage)
      outputTokens = token(usage?.output_tokens)
      cacheReadTokens = Math.max(cacheReadTokens, token(usage?.cache_read_input_tokens))
      cacheWriteTokens = Math.max(
        cacheWriteTokens,
        cacheCreationTokens(usage?.cache_creation_input_tokens),
      )
    } else if (type === 'error') {
      const error = asRecord(value.error)
      throw new KernelError(
        `llm.anthropic.${stringValue(error?.type) ?? 'stream_error'}`,
        safeDiagnosticText(stringValue(error?.message) ?? 'Anthropic stream failed'),
        {
          retryable: isRetryableAnthropicStreamError(error),
          detail: {
            ...(requestId ? { requestId } : {}),
            ...(error ? { providerError: safeProviderError(error) } : {}),
          },
        },
      )
    } else if (type === 'message_stop') {
      stopped = true
      const orderedBlocks = [...blocks.entries()].sort(([left], [right]) => left - right)
      const content = orderedBlocks.map(([, block]) => block)
      let hasTextBlock = false
      for (const [index, block] of orderedBlocks) {
        if (block.type !== 'text') continue
        hasTextBlock = true
        const completeText = stringValue(block.text)
        if (completeText === undefined) continue
        const emittedText = emittedTextByIndex.get(index) ?? ''
        const missingText = missingSuffix(completeText, emittedText)
        if (missingText !== '') {
          firstContentAt ??= Date.now()
          yield { type: 'text', text: missingText }
        }
      }
      const stopMessage = asRecord(value.message)
      const stopContent = Array.isArray(stopMessage?.content)
        ? stopMessage.content.filter(
            (item): item is Record<string, unknown> => asRecord(item) !== undefined,
          )
        : []
      if (!hasTextBlock && stopContent.length > 0) {
        const completeText = stopContent
          .filter((block) => block.type === 'text')
          .map((block) => stringValue(block.text))
          .filter((text): text is string => text !== undefined)
          .join('')
        const emittedText = [...emittedTextByIndex.values()].join('')
        const missingText = missingSuffix(completeText, emittedText)
        if (missingText !== '') {
          firstContentAt ??= Date.now()
          yield { type: 'text', text: missingText }
        }
        content.push(...stopContent)
      }
      yield {
        type: 'continuation',
        continuation: { protocol: 'anthropic-messages', data: content },
      }
      yield {
        type: 'usage',
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        callDurationMs: Math.max(0, Date.now() - startedAt),
        ...(firstContentAt === undefined
          ? {}
          : { ttftMs: Math.max(0, firstContentAt - startedAt) }),
      }
      yield { type: 'done' }
    }
  }
  if (!stopped) {
    throw new KernelError('llm.incomplete_stream', 'Anthropic stream ended before message_stop', {
      retryable: true,
      detail: { ...(requestId ? { requestId } : {}) },
    })
  }
}

function isRetryableAnthropicStreamError(error: Record<string, unknown> | undefined): boolean {
  const type = stringValue(error?.type)?.toLowerCase()
  if (type === undefined) return true
  return ![
    'authentication_error',
    'billing_error',
    'content_filter_error',
    'invalid_request_error',
    'not_found_error',
    'permission_error',
    'request_too_large',
  ].includes(type)
}

function missingSuffix(completeText: string, emittedText: string): string {
  if (completeText === emittedText) return ''
  if (completeText.startsWith(emittedText)) return completeText.slice(emittedText.length)
  // A gateway may omit or reorder deltas. Prefer one complete answer over a
  // silent answer, while avoiding duplication when the normal prefix exists.
  return completeText
}

function parseEvent(data: string, provider: string, requestId?: string): Record<string, unknown> {
  const value = parseJson(data, `llm.${provider}.invalid_sse_json`, requestId)
  const record = asRecord(value)
  if (!record) malformed('event', requestId)
  return record
}

function parseJson(
  data: string,
  code: string,
  requestId?: string,
  extraDetail: Readonly<Record<string, unknown>> = {},
): unknown {
  try {
    return JSON.parse(data)
  } catch (error) {
    throw new KernelError(code, 'Provider stream contained invalid JSON', {
      cause: error,
      detail: {
        ...(requestId ? { requestId } : {}),
        ...extraDetail,
        parseError: safeDiagnosticText(
          error instanceof Error ? error.message : 'Unknown JSON parse error',
          256,
        ),
        likelyTruncated: isLikelyTruncatedJson(data, error),
      },
    })
  }
}

function isLikelyTruncatedJson(data: string, error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return (
    /unexpected end|unterminated/u.test(message) ||
    !['}', ']'].includes(data.trimEnd().at(-1) ?? '')
  )
}

function malformed(type: unknown, requestId?: string): never {
  throw new KernelError(
    'llm.anthropic.malformed_event',
    `Malformed Anthropic ${String(type)} event`,
    {
      detail: { ...(requestId ? { requestId } : {}) },
    },
  )
}

function requiredString(value: unknown, type: unknown, requestId?: string): string {
  return stringValue(value) ?? malformed(type, requestId)
}

function indexValue(value: unknown): number {
  const index = numberValue(value)
  if (index === undefined || !Number.isInteger(index) || index < 0) malformed('content block')
  return index
}

function token(value: unknown): number {
  const number = numberValue(value)
  return number === undefined ? 0 : Math.max(0, Math.trunc(number))
}

function cacheCreationTokens(value: unknown): number {
  if (typeof value === 'number') return token(value)
  const record = asRecord(value)
  return Object.values(record ?? {}).reduce<number>((sum, item) => sum + token(item), 0)
}

function messagesEndpoint(value: string): string {
  const normalized = value.replace(/\/+$/u, '')
  // 渠道配置允许填完整 messages 地址；直接追加会拼成 …/v1/messages/v1/messages（404）。
  if (normalized.endsWith('/v1/messages')) return normalized
  if (normalized.endsWith('/messages')) return normalized.replace(/\/messages$/u, '/v1/messages')
  return normalized.endsWith('/v1') ? `${normalized}/messages` : `${normalized}/v1/messages`
}
