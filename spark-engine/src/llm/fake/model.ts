import { KernelError } from '../../kernel/errors.js';
import { throwIfAborted } from '../../kernel/cancellation.js';
import type { LlmCallContext, LlmService } from '../../seams.js';
import type { LlmDelta, LlmRequest } from '../types.js';
import type { FakeReply, FakeScriptItem } from './reply-dsl.js';

export type FakeFallback = (request: LlmRequest, callIndex: number) => FakeScriptItem;

export class FakeModel implements LlmService {
  readonly #script: FakeScriptItem[];
  readonly #fallback?: FakeFallback;
  readonly requests: LlmRequest[] = [];
  #callIndex = 0;

  constructor(script: readonly FakeScriptItem[], fallback?: FakeFallback) {
    this.#script = [...script];
    if (fallback) this.#fallback = fallback;
  }

  async *stream(request: LlmRequest, context: LlmCallContext): AsyncIterable<LlmDelta> {
    throwIfAborted(context.signal);
    this.requests.push(structuredClone(request));
    const callIndex = this.#callIndex;
    this.#callIndex += 1;
    const item = this.#script.shift() ?? this.#fallback?.(request, callIndex);
    if (!item) {
      throw new KernelError('fake.script_exhausted', `FakeModel script exhausted at call ${callIndex}`);
    }
    if (item.kind === 'failure') {
      throw new KernelError(item.code, item.message, { retryable: item.retryable });
    }
    yield* emitReply(item, context.signal);
  }

  remaining(): number {
    return this.#script.length;
  }
}

async function* emitReply(reply: FakeReply, signal: AbortSignal): AsyncIterable<LlmDelta> {
  if (reply.message.thinking) {
    for (const chunk of chunks(reply.message.thinking, reply.chunkSize)) {
      throwIfAborted(signal);
      await Promise.resolve();
      yield { type: 'thinking', text: chunk };
    }
  }
  if (reply.message.text) {
    for (const chunk of chunks(reply.message.text, reply.chunkSize)) {
      throwIfAborted(signal);
      await Promise.resolve();
      yield { type: 'text', text: chunk };
    }
  }
  for (const call of reply.message.toolCalls) {
    throwIfAborted(signal);
    yield { type: 'tool_call', callId: call.callId, name: call.name, args: call.args };
  }
  yield {
    type: 'usage',
    inputTokens: reply.usage.inputTokens,
    outputTokens: reply.usage.outputTokens,
    cacheReadTokens: reply.usage.cacheReadTokens,
    cacheWriteTokens: reply.usage.cacheWriteTokens,
  };
  yield { type: 'done' };
}

function chunks(value: string, chunkSize: number): string[] {
  if (chunkSize <= 0) return [value];
  const result: string[] = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    result.push(value.slice(index, index + chunkSize));
  }
  return result;
}
