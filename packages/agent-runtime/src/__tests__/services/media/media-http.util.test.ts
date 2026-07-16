import { describe, expect, it, vi } from 'vitest'
import { fetchJson, pollTask } from '../../../services/media/media-http.util.js'

describe('pollTask diagnostics', () => {
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
      pollTask('https://ark.cn-beijing.volces.com/api/v3/tasks/task-1', {}, {
        fetchImpl,
        intervalMs: 1,
        timeoutMs: 5,
        inspect: () => 'pending',
        logContext: 'provider=volcengine-ark requestId=task-1',
        describeResponse: (data) => data,
      }),
    ).rejects.toMatchObject({ code: 'task_timeout' })

    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain(
      'response={"status":"running","progress":42}',
    )
  })
})
