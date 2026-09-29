import { describe, expect, it, vi } from 'vitest'
import { fetchMinimaxVoiceCatalog } from '../../../services/media/minimax-voice-catalog.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const FULL_PAYLOAD = {
  system_voice: [
    {
      voice_id: 'Chinese (Mandarin)_News_Anchor',
      voice_name: 'News Anchor (Female)',
      description: ['broadcast style'],
      created_time: '1970-01-01',
    },
    { voice_id: 'male-qn-qingse', voice_name: 'male-qn-qingse', created_time: '1970-01-01' },
  ],
  voice_cloning: [{ voice_id: 'test12345', description: [], created_time: '2025-08-20' }],
  voice_generation: [
    { voice_id: 'ttv-voice-2025082011321125-2uEN0X1S', created_time: '2025-08-20' },
  ],
  base_resp: { status_code: 0, status_msg: 'success' },
}

describe('fetchMinimaxVoiceCatalog', () => {
  it('拉取 /v1/get_voice 并把系统音色排在私有音色之前、voice_name 映射为 label', async () => {
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        expect(String(input)).toBe('https://api.minimaxi.com/v1/get_voice')
        expect(init?.method).toBe('POST')
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer mm-key')
        expect(JSON.parse(String(init?.body))).toEqual({ voice_type: 'all' })
        return jsonResponse(FULL_PAYLOAD)
      },
    )

    const result = await fetchMinimaxVoiceCatalog({
      // 结尾 /v1 与斜杠都会被归一，避免出现 /v1/v1/get_voice
      apiEndpoint: 'https://api.minimaxi.com/v1/',
      apiKey: 'mm-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(result.options).toEqual([
      { value: 'Chinese (Mandarin)_News_Anchor', label: 'News Anchor (Female)' },
      // voice_name 与 voice_id 相同时不重复成 label
      { value: 'male-qn-qingse' },
      { value: 'test12345' },
      { value: 'ttv-voice-2025082011321125-2uEN0X1S' },
    ])
    expect(result.officialCount).toBe(2)
    expect(result.privateCount).toBe(2)
    expect(result.privateVoices.map((option) => option.value)).toEqual([
      'test12345',
      'ttv-voice-2025082011321125-2uEN0X1S',
    ])
  })

  it('base_resp 非 0 时抛出可读错误（不透传空候选）', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } }),
    )

    await expect(
      fetchMinimaxVoiceCatalog({
        apiEndpoint: 'https://api.minimaxi.com',
        apiKey: 'bad-key',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/1004 invalid api key/)
  })

  it('HTTP 非 2xx 时抛出带状态码的错误', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'nope' }, 401))

    await expect(
      fetchMinimaxVoiceCatalog({
        apiEndpoint: 'https://api.minimaxi.com',
        apiKey: 'bad-key',
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 401/)
  })

  it('「完整 URL」渠道直接拒绝，不做路径猜测', async () => {
    const fetchMock = vi.fn()
    await expect(
      fetchMinimaxVoiceCatalog({
        apiEndpoint: 'https://api.minimaxi.com/v1/t2a_v2',
        apiKey: 'mm-key',
        apiEndpointFullUrl: true,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/完整 URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('空音色列表返回空候选而不是报错', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ system_voice: [], voice_cloning: [], base_resp: { status_code: 0 } }),
    )

    const result = await fetchMinimaxVoiceCatalog({
      apiEndpoint: 'https://api.minimaxi.com',
      apiKey: 'mm-key',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(result.options).toEqual([])
    expect(result.officialCount).toBe(0)
    expect(result.privateCount).toBe(0)
  })
})
