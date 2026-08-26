import { KernelError } from '../../kernel/errors.js'
import type { LlmCallContext, LlmService } from '../../seams.js'
import { asRecord, numberValue, openSse, stringValue, type FetchLike } from '../http/client.js'
import type { IrMessage, LlmDelta, LlmRequest, ProviderContinuation } from '../types.js'

export interface OpenAiResponsesOptions {
  readonly apiKey: string
  readonly model: string
  readonly baseUrl?: string
  readonly fetch?: FetchLike
}

export class OpenAiResponsesService implements LlmService {
  readonly #options: OpenAiResponsesOptions

  constructor(options: OpenAiResponsesOptions) {
    if (!options.apiKey) throw new Error('OpenAI API key is required')
    if (!options.model) throw new Error('OpenAI model is required')
    this.#options = options
  }

  async *stream(request: LlmRequest, context: LlmCallContext): AsyncIterable<LlmDelta> {
    const opened = await openSse({
      provider: 'openai',
      url: `${normalizeBaseUrl(this.#options.baseUrl ?? 'https://api.openai.com/v1')}/responses`,
      headers: { authorization: `Bearer ${this.#options.apiKey}` },
      body: toOpenAiRequest(request, this.#options.model),
      signal: context.signal,
      ...(this.#options.fetch ? { fetch: this.#options.fetch } : {}),
    })
    yield* decodeOpenAiEvents(opened.events, opened.requestId)
  }
}

export function toOpenAiRequest(request: LlmRequest, model: string): Record<string, unknown> {
  return {
    model,
    stream: true,
    max_output_tokens: request.maxTokens,
    instructions: request.system.map((section) => section.content).join('\n\n'),
    input: toOpenAiInput(request.messages),
    tools: request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    })),
    ...(request.stopSequences?.length ? { stop: request.stopSequences } : {}),
    ...(request.thinking?.type === 'adaptive'
      ? {
          reasoning: {
            effort: request.thinking.effort ?? 'high',
            ...(request.thinking.display === 'summarized' ? { summary: 'auto' } : {}),
          },
        }
      : request.thinking?.type === 'enabled'
        ? { reasoning: { effort: effortFromBudget(request.thinking.budgetTokens) } }
        : {}),
  }
}

/** Maps the neutral token budget onto the Responses API coarse effort scale. */
function effortFromBudget(budgetTokens: number): 'low' | 'medium' | 'high' {
  if (budgetTokens >= 24_576) return 'high'
  if (budgetTokens >= 8_192) return 'medium'
  return 'low'
}

function toOpenAiInput(messages: readonly IrMessage[]): unknown[] {
  const input: unknown[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      input.push({ role: 'user', content: [{ type: 'input_text', text: message.content }] })
    } else if (message.role === 'tool_result') {
      input.push({ type: 'function_call_output', call_id: message.callId, output: message.content })
    } else {
      const continuation = continuationItems(message.continuation)
      if (continuation) {
        input.push(...continuation)
        continue
      }
      if (message.content) {
        input.push({
          role: 'assistant',
          content: [{ type: 'output_text', text: message.content, annotations: [] }],
        })
      }
      for (const call of message.toolCalls) {
        input.push({
          type: 'function_call',
          call_id: call.callId,
          name: call.name,
          arguments: JSON.stringify(call.args),
        })
      }
    }
  }
  return input
}

function continuationItems(continuation: ProviderContinuation | undefined): unknown[] | undefined {
  if (continuation?.protocol !== 'openai-responses' || !Array.isArray(continuation.data)) {
    return undefined
  }
  const items = continuation.data.filter((item) => asRecord(item))
  return items.length === continuation.data.length ? structuredClone(items) : undefined
}

async function* decodeOpenAiEvents(
  events: AsyncIterable<{ readonly data: string }>,
  requestId?: string,
): AsyncIterable<LlmDelta> {
  const emittedCalls = new Set<string>()
  let completed = false

  for await (const event of events) {
    if (event.data === '[DONE]') continue
    const value = parseEvent(event.data, requestId)
    const type = stringValue(value.type)
    if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
      yield { type: 'text', text: requiredString(value.delta, type, requestId) }
    } else if (
      type === 'response.reasoning_summary_text.delta' ||
      type === 'response.reasoning_text.delta'
    ) {
      yield { type: 'thinking', text: requiredString(value.delta, type, requestId) }
    } else if (type === 'response.output_item.done') {
      const item = asRecord(value.item)
      if (!item) malformed(type, requestId)
      const call = parseFunctionCall(item, requestId)
      if (call && !emittedCalls.has(call.callId)) {
        emittedCalls.add(call.callId)
        yield call
      }
    } else if (type === 'response.completed') {
      const response = asRecord(value.response)
      if (!response) malformed(type, requestId)
      const output = Array.isArray(response.output) ? response.output : []
      for (const rawItem of output) {
        const item = asRecord(rawItem)
        if (!item) malformed(type, requestId)
        const call = parseFunctionCall(item, requestId)
        if (call && !emittedCalls.has(call.callId)) {
          emittedCalls.add(call.callId)
          yield call
        }
      }
      const usage = asRecord(response.usage)
      const inputDetails = asRecord(usage?.input_tokens_details)
      yield {
        type: 'continuation',
        continuation: { protocol: 'openai-responses', data: structuredClone(output) },
      }
      yield {
        type: 'usage',
        inputTokens: token(usage?.input_tokens),
        outputTokens: token(usage?.output_tokens),
        cacheReadTokens: token(inputDetails?.cached_tokens),
        cacheWriteTokens: 0,
      }
      yield { type: 'done' }
      completed = true
    } else if (type === 'response.failed' || type === 'response.incomplete') {
      const response = asRecord(value.response)
      const error = asRecord(response?.error)
      const incomplete = asRecord(response?.incomplete_details)
      throw new KernelError(
        type === 'response.failed'
          ? 'llm.openai.response_failed'
          : 'llm.openai.response_incomplete',
        stringValue(error?.message) ?? stringValue(incomplete?.reason) ?? `OpenAI emitted ${type}`,
        {
          retryable: type === 'response.failed',
          detail: { ...(requestId ? { requestId } : {}) },
        },
      )
    } else if (type === 'error') {
      const error = asRecord(value.error) ?? value
      throw new KernelError(
        `llm.openai.${stringValue(error.code) ?? 'stream_error'}`,
        stringValue(error.message) ?? 'OpenAI stream failed',
        { retryable: true, detail: { ...(requestId ? { requestId } : {}) } },
      )
    } else if (type === 'response.in_progress' || type === 'response.created') {
      yield { type: 'heartbeat' }
    }
  }
  if (!completed) {
    throw new KernelError(
      'llm.incomplete_stream',
      'OpenAI stream ended before response.completed',
      {
        retryable: true,
        detail: { ...(requestId ? { requestId } : {}) },
      },
    )
  }
}

function parseFunctionCall(
  item: Record<string, unknown>,
  requestId?: string,
): Extract<LlmDelta, { type: 'tool_call' }> | undefined {
  if (item.type !== 'function_call') return undefined
  const argumentsText = requiredString(item.arguments, 'function_call', requestId)
  let args: unknown
  try {
    args = JSON.parse(argumentsText)
  } catch (error) {
    throw new KernelError(
      'llm.openai.invalid_tool_json',
      'OpenAI returned invalid function arguments',
      {
        cause: error,
        detail: { ...(requestId ? { requestId } : {}) },
      },
    )
  }
  return {
    type: 'tool_call',
    callId: requiredString(item.call_id, 'function_call', requestId),
    name: requiredString(item.name, 'function_call', requestId),
    args,
  }
}

function parseEvent(data: string, requestId?: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch (error) {
    throw new KernelError('llm.openai.invalid_sse_json', 'OpenAI stream contained invalid JSON', {
      cause: error,
      detail: { ...(requestId ? { requestId } : {}) },
    })
  }
  const record = asRecord(value)
  if (!record) malformed('event', requestId)
  return record
}

function malformed(type: unknown, requestId?: string): never {
  throw new KernelError('llm.openai.malformed_event', `Malformed OpenAI ${String(type)} event`, {
    detail: { ...(requestId ? { requestId } : {}) },
  })
}

function requiredString(value: unknown, type: unknown, requestId?: string): string {
  return stringValue(value) ?? malformed(type, requestId)
}

function token(value: unknown): number {
  const number = numberValue(value)
  return number === undefined ? 0 : Math.max(0, Math.trunc(number))
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.replace(/\/+$/u, '')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}
