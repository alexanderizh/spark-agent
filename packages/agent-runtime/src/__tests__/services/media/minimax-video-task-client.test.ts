import { describe, expect, it, vi } from 'vitest'
import {
  MinimaxVideoTaskClient,
  resolveMinimaxVideoTasksBaseUrl,
} from '../../../services/media/minimax-video-task-client.js'

function response(body: unknown, status = 200): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('MinimaxVideoTaskClient', () => {
  it('lists and normalizes MiniMax V2 tasks', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        items: [
          {
            id: 'mm-task-1',
            model: 'MiniMax-H3',
            status: 'succeeded',
            content: { url: 'https://cdn.example.com/mm-task-1.mp4' },
            resolution: '2K',
            duration: 5,
            created_at: 1_735_689_600,
            updated_at: 1_735_689_900,
          },
        ],
        total: 21,
      }),
    )
    const client = new MinimaxVideoTaskClient({ apiKey: 'sk-minimax-test', fetch: fetchMock })

    const page = await client.list({
      providerProfileId: 'minimax-profile',
      pageNum: 2,
      pageSize: 20,
      status: 'succeeded',
      model: 'MiniMax-H3',
    })

    expect(page).toMatchObject({
      providerKind: 'minimax-hailuo',
      pageNum: 2,
      pageSize: 20,
      hasMore: false,
    })
    expect(page.tasks[0]).toMatchObject({
      id: 'mm-task-1',
      status: 'succeeded',
      model: 'MiniMax-H3',
      videoUrl: 'https://cdn.example.com/mm-task-1.mp4',
      createdAt: '2025-01-01T00:00:00.000Z',
    })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain(
      '/v2/query/video_generation?page_num=2&page_size=20&filter.status=succeeded',
    )
    expect(String(url)).toContain('filter.model=MiniMax-H3')
    expect(init?.headers).toMatchObject({ authorization: 'Bearer sk-minimax-test' })
  })

  it('gets V2 details and deletes a task with the official DELETE endpoint', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          task: {
            id: 'mm-task-2',
            model: 'MiniMax-H3',
            status: 'queued',
            created_at: 1_735_689_600,
          },
        }),
      )
      .mockResolvedValueOnce(
        response({ task_id: 'mm-task-2', action: 'cancelled', status: 'cancelled' }),
      )
    const client = new MinimaxVideoTaskClient({ apiKey: 'sk-minimax-test', fetch: fetchMock })

    const task = await client.get('mm-task-2', { providerProfileId: 'minimax-profile' })
    const deleted = await client.delete('mm-task-2', 'minimax-profile')

    expect(task).toMatchObject({ id: 'mm-task-2', status: 'queued', model: 'MiniMax-H3' })
    expect(deleted).toEqual({ deleted: true, id: 'mm-task-2', action: 'cancelled' })
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/v2/video_generation/mm-task-2')
  })

  it('falls back to the legacy V1 status query for older Hailuo tasks', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ error: { type: 'not_found', message: 'not found' } }, 404))
      .mockResolvedValueOnce(
        response({
          task_id: 'legacy-task-1',
          status: 'Success',
          file_id: 'file-1',
          video_width: 1920,
          video_height: 1080,
          base_resp: { status_code: 0, status_msg: 'success' },
        }),
      )
    const client = new MinimaxVideoTaskClient({ apiKey: 'sk-minimax-test', fetch: fetchMock })

    const task = await client.get('legacy-task-1', {
      providerProfileId: 'minimax-profile',
      model: 'MiniMax-Hailuo-2.3',
    })

    expect(task).toMatchObject({
      id: 'legacy-task-1',
      model: 'MiniMax-Hailuo-2.3',
      status: 'succeeded',
      resolution: '1920×1080',
    })
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      '/v1/query/video_generation?task_id=legacy-task-1',
    )
  })

  it('accepts only the official MiniMax API host', () => {
    expect(resolveMinimaxVideoTasksBaseUrl('https://api.minimaxi.com/v2')).toBe(
      'https://api.minimaxi.com',
    )
    expect(() => resolveMinimaxVideoTasksBaseUrl('https://proxy.example.com/api/v2')).toThrow(
      'Endpoint 无效',
    )
    expect(() => resolveMinimaxVideoTasksBaseUrl('http://api.minimaxi.com/v2')).toThrow(
      'Endpoint 无效',
    )
    expect(() => new MinimaxVideoTaskClient({ apiKey: ' ' })).toThrow('API Key 未配置')
  })

  it('rejects unsupported expired-status filtering instead of returning all tasks', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = new MinimaxVideoTaskClient({ apiKey: 'sk-minimax-test', fetch: fetchMock })

    await expect(
      client.list({ providerProfileId: 'minimax-profile', status: 'expired' }),
    ).rejects.toThrow('不支持按已过期状态筛选')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
