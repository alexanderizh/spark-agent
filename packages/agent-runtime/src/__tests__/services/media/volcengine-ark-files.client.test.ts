import { describe, expect, it, vi } from 'vitest'
import {
  VolcengineArkFilesClient,
  resolveVolcengineArkFilesBaseUrl,
} from '../../../services/media/volcengine-ark-files.client.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('VolcengineArkFilesClient', () => {
  it('normalizes standard and Coding Plan endpoints to the official Files base URL', () => {
    expect(resolveVolcengineArkFilesBaseUrl('https://ark.cn-beijing.volces.com/api/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3',
    )
    expect(
      resolveVolcengineArkFilesBaseUrl('https://ark.cn-beijing.volces.com/api/coding/v3'),
    ).toBe('https://ark.cn-beijing.volces.com/api/v3')
    expect(resolveVolcengineArkFilesBaseUrl('https://ark.cn-beijing.volces.com/api/coding')).toBe(
      'https://ark.cn-beijing.volces.com/api/v3',
    )
  })

  it('lists files with the official cursor fields and normalizes file objects', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        object: 'list',
        data: [
          {
            object: 'file',
            id: 'file-2',
            filename: 'clip.mp4',
            bytes: 1024,
            purpose: 'user_data',
            created_at: 1_700_000_000,
            expire_at: 1_700_604_800,
            mime_type: 'video/mp4',
            status: 'processing',
            tos: { bucket: 'media', object_key: 'arkfiles/clip.mp4' },
          },
        ],
        first_id: 'file-2',
        last_id: 'file-2',
        has_more: true,
      }),
    )
    const client = new VolcengineArkFilesClient({ apiKey: 'test', fetch: fetchMock })

    const result = await client.list({ after: 'file-1', purpose: 'user_data', order: 'asc' })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://ark.cn-beijing.volces.com/api/v3/files?after=file-1&limit=100&purpose=user_data&order=asc',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer test' }),
      }),
    )
    expect(result).toMatchObject({
      providerKind: 'volcengine-ark',
      firstId: 'file-2',
      lastId: 'file-2',
      hasMore: true,
      paginationToken: 'file-2',
      files: [
        {
          id: 'file-2',
          status: 'processing',
          mimeType: 'video/mp4',
          createdAt: 1_700_000_000,
          expiresAt: 1_700_604_800,
          tos: { bucket: 'media', objectKey: 'arkfiles/clip.mp4' },
        },
      ],
    })
  })

  it('encodes URL, TOS and video preprocessing as official multipart nested fields', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        object: 'file',
        id: 'file-uploaded',
        filename: 'clip.mp4',
        bytes: 4096,
        purpose: 'user_data',
        created_at: 1_700_000_000,
        mime_type: 'video/mp4',
        status: 'processing',
      }),
    )
    const client = new VolcengineArkFilesClient({
      apiKey: 'test',
      fetch: fetchMock,
      now: () => 1_700_000_000_000,
    })

    await client.upload({
      url: 'tos://source/videos/clip.mp4',
      purpose: 'user_data',
      expireAt: 1_700_604_800,
      tos: { bucket: 'target', prefix: 'arkfiles/' },
      preprocessVideo: {
        fps: 0.3,
        model: 'doubao-seed-1-8-251228',
        maxVideoTokens: 200_000,
        minFrameTokens: 32,
        maxFrameTokens: 256,
        minFrames: 16,
      },
    })

    const init = fetchMock.mock.calls[0]?.[1]
    const form = init?.body as FormData
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://ark.cn-beijing.volces.com/api/v3/files')
    expect(form.get('purpose')).toBe('user_data')
    expect(form.get('url')).toBe('tos://source/videos/clip.mp4')
    expect(form.get('expire_at')).toBe('1700604800')
    expect(form.get('tos[bucket]')).toBe('target')
    expect(form.get('tos[prefix]')).toBe('arkfiles/')
    expect(form.get('preprocess_configs[video][fps]')).toBe('0.3')
    expect(form.get('preprocess_configs[video][model]')).toBe('doubao-seed-1-8-251228')
    expect(form.get('preprocess_configs[video][max_video_tokens]')).toBe('200000')
    expect(form.get('preprocess_configs[video][min_frame_tokens]')).toBe('32')
    expect(form.get('preprocess_configs[video][max_frame_tokens]')).toBe('256')
    expect(form.get('preprocess_configs[video][min_frames]')).toBe('16')
  })

  it('rejects unsupported URL schemes and invalid video preprocessing before calling the provider', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const client = new VolcengineArkFilesClient({ apiKey: 'test', fetch: fetchMock })

    await expect(client.upload({ url: 'file:///tmp/video.mp4' })).rejects.toThrow(
      '仅支持 HTTP、HTTPS 或 TOS URI',
    )
    await expect(
      client.upload({
        url: 'https://cdn.example.com/video.mp4',
        preprocessVideo: { fps: 6 },
      }),
    ).rejects.toThrow('fps')
    await expect(
      client.upload({
        url: 'https://cdn.example.com/document.pdf',
        preprocessVideo: { fps: 1 },
      }),
    ).rejects.toThrow('只能用于 MP4、AVI 或 MOV')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('normalizes provider timeouts into a precise Files error', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('request timed out', 'TimeoutError'))
    const client = new VolcengineArkFilesClient({ apiKey: 'test', fetch: fetchMock })

    await expect(client.get('file-timeout')).rejects.toThrow('Files 请求超时（30 秒）')
  })
})
