import { describe, expect, it, vi } from 'vitest'
import {
  cloneZhipuVoice,
  deleteZhipuVoice,
  ZHIPU_VOICE_CLONE_SAMPLE_MAX_BYTES,
} from '../../../services/media/zhipu-voice-clone.client.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

const BASE = 'https://open.bigmodel.cn/api/paas/v4'

/**
 * 音色复刻闭环：上传示例音频 → `/voice/clone` → 删除。
 *
 * 请求形状按官方 OpenAPI 断言（purpose=voice-clone-input、model=glm-tts-clone、
 * `input` 是试听文本），因为字段名写错时厂商只会回一个语义模糊的 400。
 */
describe('cloneZhipuVoice', () => {
  it('先上传示例音频再复刻，回传新音色与试听文件', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} })
      if (String(url).endsWith('/files')) {
        return jsonResponse({ id: 'file_sample_1', object: 'file', purpose: 'voice-clone-input' })
      }
      return jsonResponse({ voice: 'voice_clone_1', file_id: 'file_preview_1' })
    })

    const result = await cloneZhipuVoice({
      apiEndpoint: BASE,
      apiKey: 'zhipu-key',
      samplePath: '/tmp/sample.mp3',
      voiceName: '我的播客音色',
      previewText: '试听一句话',
      readFileImpl: async () => Buffer.from('fake-mp3'),
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(result).toEqual({
      voice: 'voice_clone_1',
      sampleFileId: 'file_sample_1',
      previewFileId: 'file_preview_1',
    })
    expect(calls[0]?.url).toBe(`${BASE}/files`)
    const uploadForm = calls[0]?.init.body as FormData
    expect(uploadForm.get('purpose')).toBe('voice-clone-input')
    expect((uploadForm.get('file') as File).name).toBe('sample.mp3')
    expect(calls[1]?.url).toBe(`${BASE}/voice/clone`)
    expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
      model: 'glm-tts-clone',
      voice_name: '我的播客音色',
      input: '试听一句话',
      file_id: 'file_sample_1',
    })
  })

  it('缺省试听文本时用平台默认句，仍带 text 直传示例文本', async () => {
    let cloneBody: Record<string, unknown> = {}
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/files')) return jsonResponse({ id: 'file_sample_2' })
      cloneBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({ voice: 'voice_clone_2' })
    })

    await cloneZhipuVoice({
      apiEndpoint: BASE,
      apiKey: 'zhipu-key',
      samplePath: '/tmp/sample.wav',
      voiceName: '音色B',
      sampleText: '示例音频的文本',
      readFileImpl: async () => Buffer.from('fake-wav'),
      fetchImpl: fetchMock as unknown as typeof fetch,
    })

    expect(typeof cloneBody.input).toBe('string')
    expect(String(cloneBody.input).length).toBeGreaterThan(0)
    expect(cloneBody.text).toBe('示例音频的文本')
  })

  it('本地先拦掉非 mp3/wav 与超过 10MB 的示例音频', async () => {
    const fetchMock = vi.fn()
    const base = {
      apiEndpoint: BASE,
      apiKey: 'zhipu-key',
      voiceName: '音色C',
      fetchImpl: fetchMock as unknown as typeof fetch,
    }

    await expect(
      cloneZhipuVoice({
        ...base,
        samplePath: '/tmp/sample.m4a',
        readFileImpl: async () => Buffer.from('x'),
      }),
    ).rejects.toThrow(/仅支持 mp3 \/ wav/)

    await expect(
      cloneZhipuVoice({
        ...base,
        samplePath: '/tmp/sample.mp3',
        readFileImpl: async () => Buffer.alloc(ZHIPU_VOICE_CLONE_SAMPLE_MAX_BYTES + 1),
      }),
    ).rejects.toThrow(/不能超过 10MB/)

    // 两道守卫都在本地完成，不应发出任何请求
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('拒绝「完整 URL」渠道而不是猜测子端点，也拒绝空音色名', async () => {
    const fetchMock = vi.fn()
    const readFileImpl = async () => Buffer.from('fake-mp3')

    await expect(
      cloneZhipuVoice({
        apiEndpoint: `${BASE}/audio/speech`,
        apiKey: 'zhipu-key',
        apiEndpointFullUrl: true,
        samplePath: '/tmp/sample.mp3',
        voiceName: '音色D',
        readFileImpl,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/完整 URL/)

    await expect(
      cloneZhipuVoice({
        apiEndpoint: BASE,
        apiKey: 'zhipu-key',
        samplePath: '/tmp/sample.mp3',
        voiceName: '   ',
        readFileImpl,
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/音色名称/)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('2xx 但未返回音色 id 时按失败处理', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/files')) return jsonResponse({ id: 'file_sample_3' })
      return jsonResponse({ request_id: 'req-1' })
    })

    await expect(
      cloneZhipuVoice({
        apiEndpoint: BASE,
        apiKey: 'zhipu-key',
        samplePath: '/tmp/sample.mp3',
        voiceName: '音色E',
        readFileImpl: async () => Buffer.from('fake-mp3'),
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/未返回音色 id/)
  })
})

describe('deleteZhipuVoice', () => {
  it('按 voice 删除并把厂商错误原文带出来', async () => {
    const bodies: unknown[] = []
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return jsonResponse({ voice: 'voice_clone_1', update_time: '2026-09-30 10:00:00' })
    })

    await deleteZhipuVoice({
      apiEndpoint: BASE,
      apiKey: 'zhipu-key',
      voice: 'voice_clone_1',
      fetchImpl: fetchMock as unknown as typeof fetch,
    })
    expect(bodies).toEqual([{ voice: 'voice_clone_1' }])

    const failing = vi.fn(async () =>
      jsonResponse({ error: { code: '1214', message: '音色不存在' } }, 400),
    )
    await expect(
      deleteZhipuVoice({
        apiEndpoint: BASE,
        apiKey: 'zhipu-key',
        voice: 'voice_clone_missing',
        fetchImpl: failing as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 400 · 1214 音色不存在/)
  })
})
