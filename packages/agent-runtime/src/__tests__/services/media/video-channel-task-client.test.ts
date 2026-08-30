import { describe, expect, it, vi } from 'vitest'
import {
  VolcengineArkVideoTaskClient,
  resolveVolcengineArkVideoTasksBaseUrl,
} from '../../../services/media/video-channel-task-client.js'

function response(body: unknown, status = 200): Response {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('VolcengineArkVideoTaskClient', () => {
  it('normalizes official task list fields and sends Bearer API Key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [
          {
            id: 'cgt-demo-1',
            model: 'doubao-seedance-2-0-260128',
            status: 'succeeded',
            content: {
              video_url: 'https://example.com/video.mp4',
              last_frame_url: 'https://example.com/last.png',
            },
            created_at: 1_735_689_600,
            updated_at: 1_735_689_900,
            duration: 5,
            framespersecond: 24,
            generate_audio: true,
          },
        ],
        has_more: false,
      }),
    )
    const client = new VolcengineArkVideoTaskClient({
      apiKey: 'sk-test-only',
      apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      fetch: fetchMock,
    })

    const page = await client.list({ providerProfileId: 'volc-profile', pageNum: 2, pageSize: 20 })

    expect(page.tasks[0]).toMatchObject({
      id: 'cgt-demo-1',
      status: 'succeeded',
      videoUrl: 'https://example.com/video.mp4',
      lastFrameUrl: 'https://example.com/last.png',
      durationSeconds: 5,
      framesPerSecond: 24,
      generateAudio: true,
    })
    expect(page.tasks[0]?.createdAt).toBe('2025-01-01T00:00:00.000Z')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(String(url)).toContain('/api/v3/contents/generations/tasks?page_num=2&page_size=20')
    expect(String(url)).not.toContain('/api/coding/v3')
    expect(init?.headers).toMatchObject({ authorization: 'Bearer sk-test-only' })
  })

  it('supports task detail and delete with encoded task IDs', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ id: 'cgt/a', status: 'running', model: 'seedance' }))
      .mockResolvedValueOnce(response(null, 204))
    const client = new VolcengineArkVideoTaskClient({ apiKey: 'sk-test-only', fetch: fetchMock })

    const task = await client.get('cgt/a', { providerProfileId: 'volc-profile' })
    const deleted = await client.delete('cgt/a', 'volc-profile')

    expect(task).toMatchObject({ id: 'cgt/a', status: 'running' })
    expect(deleted).toEqual({ deleted: true, id: 'cgt/a' })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/cgt%2Fa')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/cgt%2Fa')
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('DELETE')
  })

  it('rejects missing API Keys before sending a request', () => {
    expect(() => new VolcengineArkVideoTaskClient({ apiKey: '  ' })).toThrow('API Key 未配置')
    expect(resolveVolcengineArkVideoTasksBaseUrl('https://ark.cn-beijing.volces.com/api/v3/')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3',
    )
    expect(() =>
      resolveVolcengineArkVideoTasksBaseUrl('http://ark.cn-beijing.volces.com/api/v3'),
    ).toThrow('Endpoint 无效')
  })
})
