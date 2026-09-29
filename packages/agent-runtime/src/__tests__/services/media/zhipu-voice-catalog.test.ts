import { describe, expect, it, vi } from 'vitest'
import { fetchZhipuVoiceCatalog } from '../../../services/media/zhipu-voice-catalog.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('fetchZhipuVoiceCatalog', () => {
  it('orders官方音色在前、复刻音色在后 and maps voice_name to label', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://open.bigmodel.cn/api/paas/v4/voice/list')
      return jsonResponse({
        voice_list: [
          { voice: 'voice_clone_001', voice_name: '我的音色', voice_type: 'PRIVATE' },
          { voice: 'tongtong', voice_name: '彤彤', voice_type: 'OFFICIAL' },
        ],
      })
    })

    const result = await fetchZhipuVoiceCatalog({
      // 结尾斜杠会被归一化，避免出现 //voice/list
      apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/',
      apiKey: 'zhipu-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(result.options).toEqual([
      { value: 'tongtong', label: '彤彤' },
      { value: 'voice_clone_001', label: '我的音色' },
    ])
    expect(result.officialCount).toBe(1)
    expect(result.privateCount).toBe(1)
  })

  it('sends the bearer credential and optional voiceType filter', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        expect(String(input)).toBe(
          'https://open.bigmodel.cn/api/paas/v4/voice/list?voiceType=PRIVATE',
        )
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer zhipu-key')
        return jsonResponse({ voice_list: [] })
      },
    )

    const result = await fetchZhipuVoiceCatalog({
      apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'zhipu-key',
      voiceType: 'PRIVATE',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(result.options).toEqual([])
    expect(result.privateCount).toBe(0)
  })

  it('omits label when voice_name equals the voice id or is missing', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        voice_list: [{ voice: 'chuichui', voice_name: 'chuichui' }, { voice: 'douji' }],
      }),
    )

    const result = await fetchZhipuVoiceCatalog({
      apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'zhipu-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(result.options).toEqual([{ value: 'chuichui' }, { value: 'douji' }])
  })

  it('skips malformed entries instead of failing the whole sync', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ voice_list: [{ voice: 'tongtong' }, { voice: '   ' }, null, 'nope', {}] }),
    )

    const result = await fetchZhipuVoiceCatalog({
      apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'zhipu-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(result.options).toEqual([{ value: 'tongtong' }])
  })

  it('refuses 完整 URL 渠道而不是猜测音色列表地址', async () => {
    await expect(
      fetchZhipuVoiceCatalog({
        apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4/audio/speech',
        apiKey: 'zhipu-key',
        apiEndpointFullUrl: true,
      }),
    ).rejects.toThrow(/完整 URL/)
  })

  it('surfaces the provider error body on non-2xx', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: { code: '1210', message: '参数错误' } }, 400),
    )

    await expect(
      fetchZhipuVoiceCatalog({
        apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
        apiKey: 'zhipu-key',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 400/)
  })
})
