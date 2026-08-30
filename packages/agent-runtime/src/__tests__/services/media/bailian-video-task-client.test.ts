import { describe, expect, it, vi } from 'vitest'
import {
  BailianVideoTaskClient,
  resolveBailianVideoTasksBaseUrl,
} from '../../../services/media/bailian-video-task-client.js'

function response(body: unknown, status = 200): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('BailianVideoTaskClient', () => {
  it('lists and normalizes Bailian tasks with page and status filters', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [
          {
            task_id: 'bailian-task-1',
            model_name: 'wan2.7-t2v-2026-06-12',
            status: 'SUCCEEDED',
            gmt_create: 1_735_689_600_000,
            end_time: 1_735_689_900_000,
          },
        ],
        page_no: 2,
        page_size: 20,
        total_page: 3,
      }),
    )
    const client = new BailianVideoTaskClient({
      apiKey: 'sk-bailian-test',
      apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
      fetch: fetchMock,
    })

    const page = await client.list({
      providerProfileId: 'bailian-profile',
      pageNum: 2,
      pageSize: 20,
      status: 'running',
      model: 'wan2.7-t2v-2026-06-12',
    })

    expect(page).toMatchObject({
      providerKind: 'bailian',
      pageNum: 2,
      pageSize: 20,
      hasMore: true,
    })
    expect(page.tasks[0]).toMatchObject({
      id: 'bailian-task-1',
      status: 'succeeded',
      model: 'wan2.7-t2v-2026-06-12',
      createdAt: '2025-01-01T00:00:00.000Z',
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain('/api/v1/tasks/?page_no=2&page_size=20&status=RUNNING')
    expect(String(url)).toContain('model_name=wan2.7-t2v-2026-06-12')
    expect(init?.headers).toMatchObject({ authorization: 'Bearer sk-bailian-test' })
  })

  it('gets video results and cancels pending tasks', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          request_id: 'request-1',
          output: {
            task_id: 'bailian-task-2',
            task_status: 'SUCCEEDED',
            video_url: 'https://example.com/video.mp4',
            submit_time: '2025-01-01 00:00:00.000',
            end_time: '2025-01-01 00:00:05.000',
          },
        }),
      )
      .mockResolvedValueOnce(response({ request_id: 'request-2' }))
    const client = new BailianVideoTaskClient({ apiKey: 'sk-bailian-test', fetch: fetchMock })

    const task = await client.get('bailian-task-2', { providerProfileId: 'bailian-profile' })
    const cancelled = await client.delete('bailian-task-2', 'bailian-profile')

    expect(task).toMatchObject({
      id: 'bailian-task-2',
      status: 'succeeded',
      videoUrl: 'https://example.com/video.mp4',
    })
    expect(cancelled).toEqual({ deleted: true, id: 'bailian-task-2', action: 'cancelled' })
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/tasks/bailian-task-2/cancel')
  })

  it('rejects non-official endpoints and missing API Keys', () => {
    expect(() => new BailianVideoTaskClient({ apiKey: ' ' })).toThrow('API Key 未配置')
    expect(() => resolveBailianVideoTasksBaseUrl('https://proxy.example.com/api/v1')).toThrow(
      'Endpoint 无效',
    )
  })

  it('rejects unsupported expired-status filtering instead of sending it upstream', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = new BailianVideoTaskClient({ apiKey: 'sk-bailian-test', fetch: fetchMock })

    await expect(
      client.list({ providerProfileId: 'bailian-profile', status: 'expired' }),
    ).rejects.toThrow('不支持按已过期状态筛选')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
