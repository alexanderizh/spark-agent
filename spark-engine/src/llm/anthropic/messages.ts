import { KernelError } from '../../kernel/errors.js';
import type { LlmCallContext, LlmService } from '../../seams.js';
import { asRecord, numberValue, openSse, stringValue, type FetchLike } from '../http/client.js';
import type { IrMessage, LlmDelta, LlmRequest, ProviderContinuation } from '../types.js';

export interface AnthropicMessagesOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly version?: string;
  readonly fetch?: FetchLike;
  readonly promptCaching?: boolean;
}

export class AnthropicMessagesService implements LlmService {
  readonly #options: AnthropicMessagesOptions;

  constructor(options: AnthropicMessagesOptions) {
    if (!options.apiKey) throw new Error('Anthropic API key is required');
    if (!options.model) throw new Error('Anthropic model is required');
    this.#options = options;
  }

  async *stream(request: LlmRequest, context: LlmCallContext): AsyncIterable<LlmDelta> {
    const opened = await openSse({
      provider: 'anthropic',
      url: messagesEndpoint(this.#options.baseUrl ?? 'https://api.anthropic.com'),
      headers: {
        'x-api-key': this.#options.apiKey,
        'anthropic-version': this.#options.version ?? '2023-06-01',
      },
      body: toAnthropicRequest(request, this.#options.model, this.#options.promptCaching ?? true),
      signal: context.signal,
      ...(this.#options.fetch ? { fetch: this.#options.fetch } : {}),
    });
    yield* decodeAnthropicEvents(opened.events, opened.requestId);
  }
}

export function toAnthropicRequest(
  request: LlmRequest,
  model: string,
  promptCaching: boolean,
): Record<string, unknown> {
  const system = request.system.map((section) => ({ type: 'text', text: section.content }));
  const tools = request.tools.map((tool) => {
    if (typeof tool.inputSchema === 'boolean') {
      throw new KernelError(
        'llm.anthropic.unsupported_tool_schema',
        `Anthropic tool ${tool.name} requires an object JSON Schema`,
      );
    }
    return { name: tool.name, description: tool.description, input_schema: tool.inputSchema };
  });
  return {
    model,
    max_tokens: request.maxTokens,
    stream: true,
    system,
    messages: toAnthropicMessages(request.messages),
    ...(tools.length === 0 ? {} : { tools }),
    ...(request.stopSequences?.length ? { stop_sequences: request.stopSequences } : {}),
    ...(request.thinking ? { thinking: toThinking(request.thinking) } : {}),
    ...(promptCaching && request.system.some((section) => section.stability === 'stable')
      ? { cache_control: { type: 'ephemeral' } }
      : {}),
  };
}

function toAnthropicMessages(messages: readonly IrMessage[]): Record<string, unknown>[] {
  const result: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  const append = (role: 'user' | 'assistant', blocks: unknown[]): void => {
    const last = result.at(-1);
    if (last?.role === role) last.content.push(...blocks);
    else result.push({ role, content: [...blocks] });
  };
  for (const message of messages) {
    if (message.role === 'user') {
      append('user', [{ type: 'text', text: message.content }]);
    } else if (message.role === 'tool_result') {
      append('user', [
        {
          type: 'tool_result',
          tool_use_id: message.callId,
          content: message.content,
          ...(message.ok ? {} : { is_error: true }),
        },
      ]);
    } else {
      append('assistant', continuationBlocks(message.continuation) ?? reconstructedBlocks(message));
    }
  }
  return result;
}

function continuationBlocks(continuation: ProviderContinuation | undefined): unknown[] | undefined {
  if (continuation?.protocol !== 'anthropic-messages' || !Array.isArray(continuation.data)) {
    return undefined;
  }
  const blocks = continuation.data.filter((item) => asRecord(item));
  return blocks.length === continuation.data.length ? structuredClone(blocks) : undefined;
}

function reconstructedBlocks(message: Extract<IrMessage, { role: 'assistant' }>): unknown[] {
  const blocks: unknown[] = [];
  if (message.content) blocks.push({ type: 'text', text: message.content });
  for (const call of message.toolCalls) {
    blocks.push({ type: 'tool_use', id: call.callId, name: call.name, input: call.args });
  }
  return blocks;
}

function toThinking(thinking: NonNullable<LlmRequest['thinking']>): Record<string, unknown> {
  if (thinking.type === 'enabled') {
    return { type: 'enabled', budget_tokens: thinking.budgetTokens };
  }
  if (thinking.type === 'adaptive') {
    return { type: 'adaptive', ...(thinking.display ? { display: thinking.display } : {}) };
  }
  return { type: 'disabled' };
}

async function* decodeAnthropicEvents(
  events: AsyncIterable<{ readonly data: string }>,
  requestId?: string,
): AsyncIterable<LlmDelta> {
  const blocks = new Map<number, Record<string, unknown>>();
  const partialJson = new Map<number, string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let stopped = false;

  for await (const event of events) {
    if (event.data === '[DONE]') continue;
    const value = parseEvent(event.data, 'anthropic', requestId);
    const type = stringValue(value.type);
    if (type === 'ping') {
      yield { type: 'heartbeat' };
    } else if (type === 'message_start') {
      const usage = asRecord(asRecord(value.message)?.usage);
      inputTokens = token(usage?.input_tokens);
      cacheReadTokens = token(usage?.cache_read_input_tokens);
      cacheWriteTokens = cacheCreationTokens(usage?.cache_creation_input_tokens);
    } else if (type === 'content_block_start') {
      const index = indexValue(value.index);
      const block = asRecord(value.content_block);
      if (!block) malformed(type, requestId);
      blocks.set(index, structuredClone(block));
      if (block.type === 'tool_use') partialJson.set(index, '');
    } else if (type === 'content_block_delta') {
      const index = indexValue(value.index);
      const delta = asRecord(value.delta);
      const block = blocks.get(index);
      if (!delta || !block) malformed(type, requestId);
      if (delta.type === 'text_delta') {
        const text = requiredString(delta.text, type, requestId);
        block.text = `${stringValue(block.text) ?? ''}${text}`;
        yield { type: 'text', text };
      } else if (delta.type === 'thinking_delta') {
        const text = requiredString(delta.thinking, type, requestId);
        block.thinking = `${stringValue(block.thinking) ?? ''}${text}`;
        yield { type: 'thinking', text };
      } else if (delta.type === 'signature_delta') {
        block.signature = `${stringValue(block.signature) ?? ''}${requiredString(delta.signature, type, requestId)}`;
      } else if (delta.type === 'input_json_delta') {
        partialJson.set(
          index,
          `${partialJson.get(index) ?? ''}${requiredString(delta.partial_json, type, requestId)}`,
        );
      }
    } else if (type === 'content_block_stop') {
      const index = indexValue(value.index);
      const block = blocks.get(index);
      if (!block) malformed(type, requestId);
      if (block.type === 'tool_use') {
        const json = partialJson.get(index) ?? '';
        const args = json ? parseJson(json, 'llm.anthropic.invalid_tool_json', requestId) : block.input;
        block.input = args;
        yield {
          type: 'tool_call',
          callId: requiredString(block.id, type, requestId),
          name: requiredString(block.name, type, requestId),
          args,
        };
      }
    } else if (type === 'message_delta') {
      const usage = asRecord(value.usage);
      outputTokens = token(usage?.output_tokens);
      cacheReadTokens = Math.max(cacheReadTokens, token(usage?.cache_read_input_tokens));
      cacheWriteTokens = Math.max(
        cacheWriteTokens,
        cacheCreationTokens(usage?.cache_creation_input_tokens),
      );
    } else if (type === 'error') {
      const error = asRecord(value.error);
      throw new KernelError(
        `llm.anthropic.${stringValue(error?.type) ?? 'stream_error'}`,
        stringValue(error?.message) ?? 'Anthropic stream failed',
        { retryable: true, detail: { ...(requestId ? { requestId } : {}) } },
      );
    } else if (type === 'message_stop') {
      stopped = true;
      const content = [...blocks.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, block]) => block);
      yield { type: 'continuation', continuation: { protocol: 'anthropic-messages', data: content } };
      yield {
        type: 'usage',
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
      };
      yield { type: 'done' };
    }
  }
  if (!stopped) {
    throw new KernelError('llm.incomplete_stream', 'Anthropic stream ended before message_stop', {
      retryable: true,
      detail: { ...(requestId ? { requestId } : {}) },
    });
  }
}

function parseEvent(data: string, provider: string, requestId?: string): Record<string, unknown> {
  const value = parseJson(data, `llm.${provider}.invalid_sse_json`, requestId);
  const record = asRecord(value);
  if (!record) malformed('event', requestId);
  return record;
}

function parseJson(data: string, code: string, requestId?: string): unknown {
  try {
    return JSON.parse(data);
  } catch (error) {
    throw new KernelError(code, 'Provider stream contained invalid JSON', {
      cause: error,
      detail: { ...(requestId ? { requestId } : {}) },
    });
  }
}

function malformed(type: unknown, requestId?: string): never {
  throw new KernelError('llm.anthropic.malformed_event', `Malformed Anthropic ${String(type)} event`, {
    detail: { ...(requestId ? { requestId } : {}) },
  });
}

function requiredString(value: unknown, type: unknown, requestId?: string): string {
  return stringValue(value) ?? malformed(type, requestId);
}

function indexValue(value: unknown): number {
  const index = numberValue(value);
  if (index === undefined || !Number.isInteger(index) || index < 0) malformed('content block');
  return index;
}

function token(value: unknown): number {
  const number = numberValue(value);
  return number === undefined ? 0 : Math.max(0, Math.trunc(number));
}

function cacheCreationTokens(value: unknown): number {
  if (typeof value === 'number') return token(value);
  const record = asRecord(value);
  return Object.values(record ?? {}).reduce<number>((sum, item) => sum + token(item), 0);
}

function messagesEndpoint(value: string): string {
  const normalized = value.replace(/\/+$/u, '');
  return normalized.endsWith('/v1') ? `${normalized}/messages` : `${normalized}/v1/messages`;
}
