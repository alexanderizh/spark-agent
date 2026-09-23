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

  it('retries after visible text output by resetting the partial attempt', async () => {
    let calls = 0
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: {
            async *stream() {
              calls += 1
              if (calls === 1) {
                yield { type: 'thinking', text: 'half reasoning' } as const
                yield { type: 'text', text: 'partial' } as const
                throw new KernelError('llm.connection_reset', 'reset', { retryable: true })
              }
              yield { type: 'text', text: 'recovered' } as const
              yield { type: 'done' } as const
            },
          },
        },
        { id: 'backup', service: scripted(() => [{ type: 'text', text: 'backup' }]) },
      ],
      retry: { maxRetries: 1, initialDelayMs: 0, maxDelayMs: 0, jitterRatio: 0 },
    })
    // The generator has already forwarded the failed attempt's deltas —
    // discarding them is the consumer's job via the retry delta's resetOutput.
    expect(await collect(service)).toEqual([
      { type: 'thinking', text: 'half reasoning' },
      { type: 'text', text: 'partial' },
      {
        type: 'retry',
        routeId: 'primary',
        attempt: 1,
        maxRetries: 1,
        delayMs: 0,
        resetOutput: true,
        error: { code: 'llm.connection_reset', message: 'reset' },
      },
      { type: 'text', text: 'recovered' },
      { type: 'done' },
    ])
    expect(calls).toBe(2)
  })

  it('suppresses replay after a settled tool call to avoid a divergent second call', async () => {
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: {
            async *stream() {
              yield {
                type: 'tool_call',
                callId: 'call-1',
                name: 'read',
                args: { path: 'README.md' },
              } as const
              throw new KernelError('llm.connection_reset', 'reset', { retryable: true })
            },
          },
        },
        { id: 'backup', service: scripted(() => [{ type: 'text', text: 'backup' }]) },
      ],
      retry: { maxRetries: 2 },
    })
    await expect(collect(service)).rejects.toMatchObject({
      code: 'llm.partial_stream_failed',
      detail: {
        output: { textCharacters: 0, thinkingCharacters: 0, toolCalls: 1, visible: false },
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

  it('defaults to ten retries so a transient connection failure does not end the turn', async () => {
    let calls = 0
    const delays: number[] = []
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: scripted(() => {
            calls += 1
            if (calls <= 10) {
              throw new KernelError('llm.transport_error', 'connection reset', { retryable: true })
            }
            return [{ type: 'text', text: 'recovered' }, { type: 'done' }]
          }),
        },
      ],
      // 抖动固定为 +20%（随机源注入），否则「封顶后稳定在 60s」的断言会随
      // Math.random() 抖动出 48s~60s 的结果而随机失败。
      random: () => 1,
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
    })

    const deltas = await collect(service)
    const retries = deltas.filter((delta) => delta.type === 'retry')
    // 默认策略：10 次重试 = 最多 11 次尝试，第 11 次恢复。
    expect(retries).toHaveLength(10)
    expect(retries.map((delta) => delta.attempt)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(retries.every((delta) => delta.maxRetries === 10)).toBe(true)
    expect(calls).toBe(11)
    expect(deltas.at(-1)).toEqual({ type: 'done' })
    // 退避仍逐次有界（500ms 起步、60s 封顶），不存在"单次等待无上限"。
    expect(delays).toHaveLength(10)
    expect(delays[0]).toBeGreaterThan(300)
    expect(Math.max(...delays)).toBeLessThanOrEqual(60_000)
    // 退避按 0.5s 起步指数增长，封顶后稳定在 60s（带 ±20% 抖动）。
    expect(delays.slice(-2)).toEqual([60_000, 60_000])
  })

  it('clamps an oversized retry-after instead of abandoning the route early', async () => {
    let calls = 0
    const delays: number[] = []
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
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
    })

    // 终止条件只按次数：1 小时的 Retry-After 被截断为 60s 后继续重试，
    // 直到 2 次重试用完才把原始 429 错误抛出（旧策略会立刻以
    // llm.retry_delay_exceeded 放弃该路由）。
    await expect(collect(service)).rejects.toMatchObject({
      code: 'llm.rate_limit',
      retryable: true,
    })
    expect(calls).toBe(3)
    expect(delays).toEqual([60_000, 60_000])
  })

  it('fails over only after the clamped retry budget of the primary is spent', async () => {
    let primaryCalls = 0
    const delays: number[] = []
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: scripted(() => {
            primaryCalls += 1
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
      sleep: async (milliseconds) => {
        delays.push(milliseconds)
      },
    })

    const deltas = await collect(service)
    expect(deltas.filter((delta) => delta.type !== 'retry')).toEqual([
      { type: 'text', text: 'backup' },
      { type: 'done' },
    ])
    expect(deltas.filter((delta) => delta.type === 'retry')).toHaveLength(2)
    expect(primaryCalls).toBe(3)
    expect(delays).toEqual([60_000, 60_000])
  })

  it('keeps a replay-suppressed partial failure manually retryable', async () => {
    const service = new ResilientLlmService({
      routes: [
        {
          id: 'primary',
          service: {
            async *stream() {
              yield {
                type: 'tool_call',
                callId: 'call-1',
                name: 'read',
                args: { path: 'README.md' },
              } as const
              throw new KernelError('llm.transport_error', 'socket closed', { retryable: true })
            },
          },
        },
      ],
      retry: { maxRetries: 1 },
    })

    // 自动重放被抑制是安全属性，但错误本身仍是瞬时故障：宿主必须保留手动重试入口。
    await expect(collect(service)).rejects.toMatchObject({
      code: 'llm.partial_stream_failed',
      retryable: true,
      detail: { replaySuppressed: true },
    })
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
