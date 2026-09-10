import { describe, expect, it } from 'vitest'

import { KernelError } from '../../src/kernel/errors.js'
import { consumeLlmStream } from '../../src/llm/consume.js'
import { ResilientLlmService } from '../../src/llm/resilience.js'
import type { LlmDelta, LlmRequest } from '../../src/llm/types.js'
import type { LlmService } from '../../src/seams.js'

const request: LlmRequest = { system: [], messages: [], tools: [], maxTokens: 1, metadata: {} }
const context = {
  signal: new AbortController().signal,
  turnId: 'turn-1',
  stepId: 'step-1',
}

describe('LLM retry and failover safety', () => {
  it('retries a transient pre-output failure and honors deterministic backoff seams', async () => {
    let calls = 0
    const delays: number[] = []
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: scripted(() => {
            calls += 1
            if (calls === 1) throw new KernelError('llm.rate_limit', 'slow', { retryable: true })
            return [{ type: 'text', text: 'ok' }, { type: 'done' }]
          }),
        },
      ],
      retry: { maxRetries: 1, initialDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0 },
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
    })
    expect(await collect(service)).toEqual([
      {
        type: 'retry',
        routeId: 'primary',
        attempt: 1,
        maxRetries: 1,
        delayMs: 100,
        resetOutput: false,
        error: { code: 'llm.rate_limit', message: 'slow' },
      },
      { type: 'text', text: 'ok' },
      { type: 'done' },
    ])
    expect(calls).toBe(2)
    expect(delays).toEqual([100])
  })

  it('keeps positive jitter inside the configured hard delay ceiling', async () => {
    const delays: number[] = []
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: scripted(() => {
            throw new KernelError('llm.overloaded', 'busy', { retryable: true })
          }),
        },
      ],
      retry: { maxRetries: 1, initialDelayMs: 1_000, maxDelayMs: 1_000, jitterRatio: 1 },
      random: () => 1,
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
    })
    await expect(collect(service)).rejects.toMatchObject({ code: 'llm.overloaded' })
    expect(delays).toEqual([1_000])
  })

  it('rejects invalid direct-SDK retry policies instead of creating unbounded loops', () => {
    expect(
      () =>
        new ResilientLlmService({
          routes: [{ id: 'primary', service: scripted(() => []) }],
          retry: { maxRetries: Number.POSITIVE_INFINITY },
        }),
    ).toThrow('maxRetries must be a non-negative integer')
  })

  it('fails over only before meaningful output', async () => {
    const backup = scripted(() => [{ type: 'text', text: 'backup' }, { type: 'done' }])
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: scripted(() => {
            throw new KernelError('llm.overloaded', 'busy', { retryable: true })
          }),
        },
        { id: 'backup', service: backup },
      ],
      retry: { maxRetries: 0 },
    })
    expect(await collect(service)).toEqual([{ type: 'text', text: 'backup' }, { type: 'done' }])
  })

  it('suppresses replay after any visible delta to prevent duplicate output', async () => {
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: {
            async *stream() {
              yield { type: 'text', text: 'partial' } as const
              throw new KernelError('llm.connection_reset', 'reset', { retryable: true })
            },
          },
        },
        { id: 'backup', service: scripted(() => [{ type: 'text', text: 'duplicate' }]) },
      ],
      retry: { maxRetries: 2 },
    })
    await expect(collect(service)).rejects.toMatchObject({
      code: 'llm.partial_stream_failed',
      detail: {
        output: { textCharacters: 7, thinkingCharacters: 0, toolCalls: 0, visible: true },
        cause: {
          code: 'llm.connection_reset',
          message: 'reset',
          retryable: true,
        },
      },
    })
  })

  it('discards uncommitted output and retries malformed tool JSON with a hard limit', async () => {
    let calls = 0
    const deltas: LlmDelta[] = []
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: {
            async *stream() {
              calls += 1
              if (calls === 1) {
                yield { type: 'thinking', text: 'long failed reasoning' } as const
                yield { type: 'text', text: 'I will write it.' } as const
                throw new KernelError(
                  'llm.anthropic.invalid_tool_json',
                  'Provider stream contained invalid JSON',
                )
              }
              yield { type: 'text', text: 'Recovered answer' } as const
              yield { type: 'usage', inputTokens: 3, outputTokens: 2 } as const
              yield { type: 'done' } as const
            },
          },
        },
      ],
      retry: { maxRetries: 1, initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    })

    const response = await consumeLlmStream(service.stream(request, context), (delta) => {
      deltas.push(delta)
    })
    expect(response.message).toEqual({ text: 'Recovered answer', toolCalls: [] })
    expect(response.usage).toMatchObject({ inputTokens: 3, outputTokens: 2 })
    expect(deltas).toContainEqual({
      type: 'retry',
      routeId: 'primary',
      attempt: 1,
      maxRetries: 1,
      delayMs: 0,
      resetOutput: true,
      error: {
        code: 'llm.anthropic.invalid_tool_json',
        message: 'Provider stream contained invalid JSON',
      },
    })
    expect(calls).toBe(2)
  })

  it('retries when only invisible bookkeeping was emitted', async () => {
    let calls = 0
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: {
            async *stream() {
              calls += 1
              if (calls === 1) {
                yield { type: 'usage', inputTokens: 1, outputTokens: 0 } as const
                yield {
                  type: 'continuation',
                  continuation: { protocol: 'anthropic-messages', data: [] },
                } as const
                throw new KernelError('llm.connection_reset', 'reset', { retryable: true })
              }
              yield { type: 'text', text: 'recovered' } as const
              yield { type: 'done' } as const
            },
          },
        },
      ],
      retry: { maxRetries: 1, initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    })

    expect(await collect(service)).toEqual([
      {
        type: 'retry',
        routeId: 'primary',
        attempt: 1,
        maxRetries: 1,
        delayMs: 0,
        resetOutput: false,
        error: { code: 'llm.connection_reset', message: 'reset' },
      },
      { type: 'text', text: 'recovered' },
      { type: 'done' },
    ])
    expect(calls).toBe(2)
  })

  it('does not hammer a route when retry-after exceeds the configured wait limit', async () => {
    let calls = 0
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: scripted(() => {
            calls += 1
            throw new KernelError('llm.rate_limit', 'quota resets later', {
              retryable: true,
              detail: { retryAfterMs: 3_600_000 },
            })
          }),
        },
      ],
      retry: { maxRetries: 2, maxDelayMs: 60_000 },
    })

    await expect(collect(service)).rejects.toMatchObject({
      code: 'llm.retry_delay_exceeded',
      retryable: false,
      detail: {
        requestedDelayMs: 3_600_000,
        maxDelayMs: 60_000,
        cause: { code: 'llm.rate_limit' },
      },
    })
    expect(calls).toBe(1)
  })

  it('fails over instead of waiting beyond the retry-after limit', async () => {
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: scripted(() => {
            throw new KernelError('llm.rate_limit', 'quota resets later', {
              retryable: true,
              detail: { retryAfterMs: 3_600_000 },
            })
          }),
        },
        {
          id: 'backup',
          service: scripted(() => [{ type: 'text', text: 'backup' }, { type: 'done' }]),
        },
      ],
      retry: { maxRetries: 2, maxDelayMs: 60_000 },
    })

    expect(await collect(service)).toEqual([{ type: 'text', text: 'backup' }, { type: 'done' }])
  })
})

function scripted(factory: () => readonly LlmDelta[]): LlmService {
  return {
    async *stream() {
      for (const delta of factory()) yield delta
    },
  }
}

async function collect(service: LlmService): Promise<LlmDelta[]> {
  const deltas: LlmDelta[] = []
  for await (const delta of service.stream(request, context)) deltas.push(delta)
  return deltas
}
