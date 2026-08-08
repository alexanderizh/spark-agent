import { describe, expect, it, vi } from 'vitest'
import {
  describeNetworkError,
  fetchJson,
  isRetryableMediaError,
  pollRequestTimeoutMs,
  pollSleepIntervalMs,
  pollTask,
} from '../../../services/media/media-http.util.js'
import { MediaProviderError } from '../../../services/media/media-adapter.types.js'

describe('pollTask diagnostics', () => {
  it('caps each polling request by the remaining operation deadline', () => {
    expect(pollRequestTimeoutMs(2_000, 6_000, 1_500)).toBe(500)
    expect(pollRequestTimeoutMs(60_000, undefined, 10_000)).toBe(30_000)
    expect(pollRequestTimeoutMs(10_001, undefined, 10_000)).toBe(1)
  })

  it('caps polling sleep by the remaining operation deadline', () => {
    expect(pollSleepIntervalMs(2_000, 5_000, 1_500)).toBe(500)
    expect(pollSleepIntervalMs(20_000, 5_000, 1_500)).toBe(5_000)
  })

  it('logs the sanitized polling endpoint and terminal timing', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ status: 'completed' }), { status: 200 }),
    ) as unknown as typeof fetch

    await pollTask(
      'https://api.apimart.ai/v1/tasks/task_01ABC?language=zh&token=secret',
      {},
      {
        fetchImpl,
        intervalMs: 1,
        timeoutMs: 1_000,
        inspect: () => 'done',
      },
    )

    const messages = info.mock.calls.map((call) => String(call[0]))
    expect(messages.some((message) => message.includes('[media:task-poll]'))).toBe(true)
    expect(
      messages.some((message) =>
        message.includes('event=started url=https://api.apimart.ai/v1/tasks/task_01ABC'),
      ),
    ).toBe(true)
    expect(
      messages.some((message) => message.includes('event=finished state=done attempts=1')),
    ).toBe(true)
    expect(messages.join('\n')).not.toContain('token=secret')
  })

  it('reports an explicit request timeout instead of a generic abort message', async () => {
    const fetchImpl = ((_: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'))
        })
      })) as typeof fetch

    await expect(
      fetchJson('https://api.x.ai/v1/videos/generations?token=secret', {
        method: 'POST',
        fetchImpl,
        timeoutMs: 5,
      }),
    ).rejects.toThrow('POST https://api.x.ai/v1/videos/generations timed out after 5ms')
  })

  it('keeps the last provider response summary on polling timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ status: 'running', progress: 42 })),
    ) as unknown as typeof fetch

    await expect(
      pollTask(
        'https://ark.cn-beijing.volces.com/api/v3/tasks/task-1',
        {},
        {
          fetchImpl,
          intervalMs: 1,
          timeoutMs: 5,
          inspect: () => 'pending',
          logContext: 'provider=volcengine-ark requestId=task-1',
          describeResponse: (data) => data,
        },
      ),
    ).rejects.toMatchObject({ code: 'task_timeout' })

    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      'response={"status":"running","progress":42}',
    )
  })
})

describe('pollTask transient-error retry', () => {
  const statusOf = (d: unknown): string | undefined =>
    (d as { status?: string | undefined } | null)?.status

  it('retries transient fetch failures and eventually succeeds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    const fetchImpl = vi.fn(
      async () => {
        calls += 1
        if (calls < 3) throw new TypeError('fetch failed')
        return new Response(JSON.stringify({ status: 'completed' }), { status: 200 })
      },
    ) as unknown as typeof fetch

    const result = await pollTask(
      'https://api.apimart.ai/v1/tasks/task_x',
      {},
      {
        fetchImpl,
        intervalMs: 1,
        timeoutMs: 5_000,
        retryBackoffMs: 1,
        inspect: (d) => (statusOf(d) === 'completed' ? 'done' : 'pending'),
      },
    )

    expect(result).toMatchObject({ status: 'completed' })
    expect(calls).toBe(3)
    const log = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(log).toContain('event=request-failed-retryable')
    expect(log).toContain('网络请求失败')
    expect(log).toContain('retryCount=2/3')
  })

  it('gives up after maxRetries and surfaces the underlying network hint', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn(
      async () => {
        throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED') })
      },
    ) as unknown as typeof fetch

    await expect(
      pollTask(
        'https://api.apimart.ai/v1/tasks/task_x',
        {},
        {
          fetchImpl,
          intervalMs: 1,
          timeoutMs: 5_000,
          maxRetries: 2,
          retryBackoffMs: 1,
          inspect: () => 'pending',
        },
      ),
    ).rejects.toMatchObject({ code: 'provider_http_error' })

    // 1 initial attempt + 2 retries
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const log = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(log).toContain('event=request-failed ')
    expect(log).toContain('retryCount=2/2')
  })

  it('does not retry deterministic 4xx errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = vi.fn(
      async () => new Response('Not Found', { status: 404 }),
    ) as unknown as typeof fetch

    await expect(
      pollTask(
        'https://api.apimart.ai/v1/tasks/task_x',
        {},
        {
          fetchImpl,
          intervalMs: 1,
          timeoutMs: 5_000,
          retryBackoffMs: 1,
          inspect: () => 'pending',
        },
      ),
    ).rejects.toMatchObject({ code: 'provider_http_error' })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const log = warn.mock.calls.map((c) => String(c[0])).join('\n')
    expect(log).not.toContain('event=request-failed-retryable')
  })

  it('retries HTTP 5xx transient errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    const fetchImpl = vi.fn(
      async () => {
        calls += 1
        if (calls < 2) return new Response('Bad Gateway', { status: 502 })
        return new Response(JSON.stringify({ status: 'completed' }), { status: 200 })
      },
    ) as unknown as typeof fetch

    const result = await pollTask(
      'https://api.apimart.ai/v1/tasks/task_x',
      {},
      {
        fetchImpl,
        intervalMs: 1,
        timeoutMs: 5_000,
        retryBackoffMs: 1,
        inspect: (d) => (statusOf(d) === 'completed' ? 'done' : 'pending'),
      },
    )

    expect(result).toMatchObject({ status: 'completed' })
    expect(calls).toBe(2)
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'event=request-failed-retryable',
    )
  })

  it('retries HTTP 429 and respects a bounded Retry-After hint', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0
    const fetchImpl = vi.fn(
      async () => {
        calls += 1
        if (calls === 1) {
          return new Response('Too Many Requests', {
            status: 429,
            headers: { 'retry-after': '0' },
          })
        }
        return new Response(JSON.stringify({ status: 'completed' }), { status: 200 })
      },
    ) as unknown as typeof fetch

    await expect(
      pollTask('https://api.apimart.ai/v1/tasks/task_x', {}, {
        fetchImpl,
        intervalMs: 1,
        timeoutMs: 5_000,
        retryBackoffMs: 1,
        inspect: (d) => (statusOf(d) === 'completed' ? 'done' : 'pending'),
      }),
    ).resolves.toMatchObject({ status: 'completed' })

    expect(calls).toBe(2)
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('retryAfterMs=0')
  })
})

describe('network-error classification & messaging', () => {
  it('classifies retryable vs deterministic provider errors', () => {
    expect(isRetryableMediaError(new MediaProviderError('provider_http_error', 'fetch failed'))).toBe(
      true,
    )
    expect(isRetryableMediaError(new MediaProviderError('provider_http_error', 'HTTP 502', 502))).toBe(
      true,
    )
    expect(isRetryableMediaError(new MediaProviderError('provider_http_error', 'HTTP 429', 429))).toBe(
      true,
    )
    expect(isRetryableMediaError(new MediaProviderError('provider_http_error', 'HTTP 404', 404))).toBe(
      false,
    )
    expect(isRetryableMediaError(new MediaProviderError('task_failed', 'nope'))).toBe(false)
    expect(isRetryableMediaError(new TypeError('boom'))).toBe(false)
    expect(isRetryableMediaError(null)).toBe(false)
  })

  it('translates bare "fetch failed" into a readable network hint and strips secrets', async () => {
    const fetchImpl = vi.fn(
      async () => {
        throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:443') })
      },
    ) as unknown as typeof fetch

    let caught: unknown
    await fetchJson('https://api.apimart.ai/v1/images/generations?token=secret', {
      method: 'POST',
      fetchImpl,
      timeoutMs: 5_000,
    }).catch((error: unknown) => {
      caught = error
    })
    const message = caught instanceof Error ? caught.message : String(caught)
    expect(message).toMatch(/网络请求失败.*connect ECONNREFUSED/)
    expect(message).not.toContain('token=secret')
  })

  it('leaves non-network errors untouched', () => {
    expect(describeNetworkError(new Error('some unrelated boom'), 'GET', 'https://x/y')).toBeUndefined()
    expect(describeNetworkError('not-an-error', 'GET', 'https://x/y')).toBeUndefined()
  })
})
