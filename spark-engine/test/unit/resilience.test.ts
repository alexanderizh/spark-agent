import { describe, expect, it } from 'vitest';

import { KernelError } from '../../src/kernel/errors.js';
import { ResilientLlmService } from '../../src/llm/resilience.js';
import type { LlmDelta, LlmRequest } from '../../src/llm/types.js';
import type { LlmService } from '../../src/seams.js';

const request: LlmRequest = { system: [], messages: [], tools: [], maxTokens: 1, metadata: {} };
const context = {
  signal: new AbortController().signal,
  turnId: 'turn-1',
  stepId: 'step-1',
};

describe('LLM retry and failover safety', () => {
  it('retries a transient pre-output failure and honors deterministic backoff seams', async () => {
    let calls = 0;
    const delays: number[] = [];
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: scripted(() => {
            calls += 1;
            if (calls === 1) throw new KernelError('llm.rate_limit', 'slow', { retryable: true });
            return [{ type: 'text', text: 'ok' }, { type: 'done' }];
          }),
        },
      ],
      retry: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0 },
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
      },
    });
    expect(await collect(service)).toEqual([{ type: 'text', text: 'ok' }, { type: 'done' }]);
    expect(calls).toBe(2);
    expect(delays).toEqual([100]);
  });

  it('fails over only before meaningful output', async () => {
    const backup = scripted(() => [{ type: 'text', text: 'backup' }, { type: 'done' }]);
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: scripted(() => {
            throw new KernelError('llm.overloaded', 'busy', { retryable: true });
          }),
        },
        { id: 'backup', service: backup },
      ],
      retry: { maxRetries: 0 },
    });
    expect(await collect(service)).toEqual([
      { type: 'text', text: 'backup' },
      { type: 'done' },
    ]);
  });

  it('suppresses replay after any visible delta to prevent duplicate output', async () => {
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: {
            async *stream() {
              yield { type: 'text', text: 'partial' } as const;
              throw new KernelError('llm.connection_reset', 'reset', { retryable: true });
            },
          },
        },
        { id: 'backup', service: scripted(() => [{ type: 'text', text: 'duplicate' }]) },
      ],
      retry: { maxRetries: 2 },
    });
    await expect(collect(service)).rejects.toMatchObject({ code: 'llm.partial_stream_failed' });
  });
});

function scripted(factory: () => readonly LlmDelta[]): LlmService {
  return {
    async *stream() {
      for (const delta of factory()) yield delta;
    },
  };
}

async function collect(service: LlmService): Promise<LlmDelta[]> {
  const deltas: LlmDelta[] = [];
  for await (const delta of service.stream(request, context)) deltas.push(delta);
  return deltas;
}
