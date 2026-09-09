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
    const startedAt = Date.now();
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
    yield* decodeAnthropicEvents(opened.events, opened.requestId, startedAt);
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
    ...(request.thinking ? { thinking: toThinking(request.thinking, request.maxTokens) } : {}),
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

function toThinking(
  thinking: NonNullable<LlmRequest['thinking']>,
  maxTokens: number,
): Record<string, unknown> {
  if (thinking.type === 'enabled') {
    // Anthropic counts thinking and visible answer tokens against the same
    // max_tokens ceiling. Keep a meaningful answer reserve instead of
    // allowing the default `high` budget to leave one token for the answer.
    // The reserve scales down for deliberately tiny caller-provided limits.
    const visibleReserve = Math.min(2_048, Math.max(1, Math.floor(maxTokens / 4)));
    const availableThinking = Math.max(0, maxTokens - visibleReserve);
    // Anthropic's manual budget_tokens has a 1K lower bound. When the model's
    // configured output ceiling cannot fit a valid thinking block plus a
    // visible answer reserve, disable thinking rather than sending a request
    // the provider will reject.
    if (availableThinking < 1_024) return { type: 'disabled' };
    return {
      type: 'enabled',
      budget_tokens: Math.min(thinking.budgetTokens, availableThinking),
    };
  }
  if (thinking.type === 'adaptive') {
    return { type: 'adaptive', ...(thinking.display ? { display: thinking.display } : {}) };
  }
  return { type: 'disabled' };
}

async function* decodeAnthropicEvents(
  events: AsyncIterable<{ readonly data: string }>,
  requestId: string | undefined,
  startedAt: number,
): AsyncIterable<LlmDelta> {
  const blocks = new Map<number, Record<string, unknown>>();
  const partialJson = new Map<number, string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let firstContentAt: number | undefined;
  const emittedTextByIndex = new Map<number, string>();
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
        emittedTextByIndex.set(index, `${emittedTextByIndex.get(index) ?? ''}${text}`);
        firstContentAt ??= Date.now();
        yield { type: 'text', text };
      } else if (delta.type === 'thinking_delta') {
        const text = requiredString(delta.thinking, type, requestId);
        block.thinking = `${stringValue(block.thinking) ?? ''}${text}`;
        firstContentAt ??= Date.now();
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
        const args = json
          ? parseJson(json, 'llm.anthropic.invalid_tool_json', requestId)
          : block.input;
        block.input = args;
        firstContentAt ??= Date.now();
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
      const orderedBlocks = [...blocks.entries()].sort(([left], [right]) => left - right);
      const content = orderedBlocks.map(([, block]) => block);
      let hasTextBlock = false;
      for (const [index, block] of orderedBlocks) {
        if (block.type !== 'text') continue;
        hasTextBlock = true;
        const completeText = stringValue(block.text);
        if (completeText === undefined) continue;
        const emittedText = emittedTextByIndex.get(index) ?? '';
        const missingText = missingSuffix(completeText, emittedText);
        if (missingText !== '') {
          firstContentAt ??= Date.now();
          yield { type: 'text', text: missingText };
        }
      }
      const stopMessage = asRecord(value.message);
      const stopContent = Array.isArray(stopMessage?.content)
        ? stopMessage.content.filter(
            (item): item is Record<string, unknown> => asRecord(item) !== undefined,
          )
        : [];
      if (!hasTextBlock && stopContent.length > 0) {
        const completeText = stopContent
          .filter((block) => block.type === 'text')
          .map((block) => stringValue(block.text))
          .filter((text): text is string => text !== undefined)
          .join('');
        const emittedText = [...emittedTextByIndex.values()].join('');
        const missingText = missingSuffix(completeText, emittedText);
        if (missingText !== '') {
          firstContentAt ??= Date.now();
          yield { type: 'text', text: missingText };
        }
        content.push(...stopContent);
      }
      yield {
        type: 'continuation',
        continuation: { protocol: 'anthropic-messages', data: content },
      };
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

function missingSuffix(completeText: string, emittedText: string): string {
  if (completeText === emittedText) return '';
  if (completeText.startsWith(emittedText)) return completeText.slice(emittedText.length);
  // A gateway may omit or reorder deltas. Prefer one complete answer over a
  // silent answer, while avoiding duplication when the normal prefix exists.
  return completeText;
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
  throw new KernelError(
    'llm.anthropic.malformed_event',
    `Malformed Anthropic ${String(type)} event`,
    {
      detail: { ...(requestId ? { requestId } : {}) },
    },
  );
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
