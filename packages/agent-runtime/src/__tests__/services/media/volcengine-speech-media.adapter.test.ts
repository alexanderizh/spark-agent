import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { VolcengineSpeechMediaAdapter } from '../../../services/media/adapters/volcengine-speech-media.adapter.js'
import { MediaRouterService } from '../../../services/media/media-router.service.js'
import type {
  MediaGenerateInput,
  MediaProviderContext,
} from '../../../services/media/media-adapter.types.js'
import { BUILTIN_MEDIA_MODEL_MANIFESTS, type MediaModelManifest } from '@spark/protocol'

const ENDPOINT = 'https://openspeech.bytedance.com'

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>
type FetchMock = typeof globalThis.fetch & {
  mock: { calls: Array<[string, RequestInit | undefined]> }
}

function mockFetch(handler: FetchHandler): FetchMock {
  return vi.fn(handler) as unknown as FetchMock
}

function findManifest(id: string): MediaModelManifest {
  const m = BUILTIN_MEDIA_MODEL_MANIFESTS.find((x) => x.id === id)
  if (!m) throw new Error(`manifest ${id} not found`)
  return m
}

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as Response
}

function binaryRes(buf: Buffer): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(''),
    arrayBuffer: () =>
      Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)),
  } as Response
}

// 单向流式 TTS 响应：JSON 对象序列（连续无分隔，最接近真实流且最考验花括号切分）。
// 用真实 Response 构造，使 res.body.getReader() 可被 adapter 调用。
function streamRes(frames: unknown[]): Response {
  const body = frames.map((f) => JSON.stringify(f)).join('')
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ID3v2 头（mp3 测试用，非合法完整 mp3，仅用于落盘 buffer 比对）
const FAKE_MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x10, 0x00, 0x00, 0x00, 0x20, 0x53])
// RIFF/WAVE 头（wav 测试用）
const FAKE_WAV = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
])

function makeContext(overrides: Partial<MediaProviderContext>): MediaProviderContext {
  return {
    apiKey: 'sk-test',
    apiEndpoint: ENDPOINT,
    defaultModel: 'seed-tts-2.0',
    mediaProvider: 'volcengine-speech',
    mediaApiType: 'sync',
    ...overrides,
  }
}

function makeInput(overrides: Partial<MediaGenerateInput>): MediaGenerateInput {
  return {
    operation: 'text_to_audio',
    capability: 'audio.speech',
    prompt: '你好世界',
    outputDir: '',
    ...overrides,
  }
}

describe('VolcengineSpeechMediaAdapter', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `volcengine-speech-test-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('manifest 已注册且 router 已挂 volcengine-speech adapter', () => {
    const ids = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (m) => m.providerKind === 'volcengine-speech',
    ).map((m) => m.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'volcengine-speech:seed-audio-1.0',
        'volcengine-speech:seed-tts-2.0',
      ]),
    )
    expect(new MediaRouterService().listAdapters()).toContain('volcengine-speech')
  })

  it('audio.speech: JSON 流逐帧 base64 解码 concat 落盘 + 鉴权三头 + body + usage', async () => {
    // FAKE_MP3 拆成两段，模拟流式分帧（各帧 data 为 base64 片段）
    const part1 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x10])
    const part2 = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x53])
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/api/v3/tts/unidirectional')) {
        return streamRes([
          { code: 0, message: '', data: part1.toString('base64') },
          { code: 0, message: '', data: part2.toString('base64') },
          { code: 20000000, message: 'ok', data: null, usage: { text_words: 4 } },
        ])
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await new VolcengineSpeechMediaAdapter().invoke(
      makeInput({
        capability: 'audio.speech',
        outputDir: tmpDir,
        modelParams: { speaker: 'zh_male_bvlazysheep' },
      }),
      makeContext({ fetch: fetchImpl, defaultModel: 'seed-tts-2.0' }),
    )
    expect(out.mode).toBe('sync')
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]?.type).toBe('audio')
    expect(out.assets[0]?.mimeType).toBe('audio/mpeg')
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
    // 两段 concat = FAKE_MP3
    expect(readFileSync(out.assets[0]?.filePath ?? '')).toEqual(FAKE_MP3)
    // usage 透传（结束帧的 usage 字段）
    expect((out.rawResponse as Record<string, unknown>)?.usage).toMatchObject({ text_words: 4 })

    // 鉴权三头（X-Api-Key + X-Api-Resource-Id + X-Api-Request-Id）
    const init = fetchImpl.mock.calls[0]![1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['X-Api-Key']).toBe('sk-test')
    expect(headers['X-Api-Resource-Id']).toBe('seed-tts-2.0')
    const requestId = headers['X-Api-Request-Id']
    expect(typeof requestId).toBe('string')
    expect((requestId ?? '').length).toBeGreaterThan(0)

    // body 结构：req_params(text+speaker) + audio_params(format)
    expect(JSON.parse(init.body as string)).toMatchObject({
      req_params: { text: '你好世界', speaker: 'zh_male_bvlazysheep' },
      audio_params: { format: 'mp3' },
    })
  })

  it('audio.speech 业务错误: 流内 code=45000000(音色鉴权失败) 抛错含码', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/api/v3/tts/unidirectional')) {
        return streamRes([{ code: 45000000, message: 'speaker permission denied' }])
      }
      throw new Error(`unexpected ${url}`)
    })
    await expect(
      new VolcengineSpeechMediaAdapter().invoke(
        makeInput({
          capability: 'audio.speech',
          outputDir: tmpDir,
          modelParams: { speaker: 'zh_male_unauthorized' },
        }),
        makeContext({ fetch: fetchImpl }),
      ),
    ).rejects.toThrow(/45000000/)
  })

  it('audio.speech 空音频流: 仅结束帧无 data → 抛空音频流', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/api/v3/tts/unidirectional')) {
        return streamRes([{ code: 20000000, message: 'ok', data: null }])
      }
      throw new Error(`unexpected ${url}`)
    })
    await expect(
      new VolcengineSpeechMediaAdapter().invoke(
        makeInput({
          capability: 'audio.speech',
          outputDir: tmpDir,
          modelParams: { speaker: 'zh_male_test' },
        }),
        makeContext({ fetch: fetchImpl }),
      ),
    ).rejects.toThrow(/空音频流/)
  })

  it('audio.speech speaker 缺失: modelParams/mediaDefaults 均无 → invalid_input', async () => {
    const fetchImpl = mockFetch(async () => binaryRes(FAKE_MP3))
    await expect(
      new VolcengineSpeechMediaAdapter().invoke(
        makeInput({ capability: 'audio.speech', outputDir: tmpDir }),
        makeContext({ fetch: fetchImpl, mediaDefaults: { audio: { format: 'mp3' } } }),
      ),
    ).rejects.toThrow(/speaker/)
  })

  it('audio.speech HTTP 401: 抛 provider_http_error 且含状态码', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/api/v3/tts/unidirectional')) {
        return {
          ok: false,
          status: 401,
          text: () => Promise.resolve('invalid api key'),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        } as Response
      }
      throw new Error(`unexpected ${url}`)
    })
    await expect(
      new VolcengineSpeechMediaAdapter().invoke(
        makeInput({
          capability: 'audio.speech',
          outputDir: tmpDir,
          modelParams: { speaker: 'zh_male_test' },
        }),
        makeContext({ fetch: fetchImpl }),
      ),
    ).rejects.toThrow(/401/)
  })

  it('audio.music: POST /api/v3/tts/create 顶层 url 下载落盘 wav + body 结构', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/api/v3/tts/create')) {
        return jsonRes({
          code: 0,
          url: 'https://cdn.example.com/a.wav',
          duration: 3.5,
          original_duration: 3.5,
        })
      }
      if (url === 'https://cdn.example.com/a.wav') return binaryRes(FAKE_WAV)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await new VolcengineSpeechMediaAdapter().invoke(
      makeInput({
        capability: 'audio.music',
        prompt: '生成一段轻快的钢琴配乐',
        outputDir: tmpDir,
      }),
      makeContext({ fetch: fetchImpl, defaultModel: 'seed-audio-1.0' }),
    )
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]?.type).toBe('audio')
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
    expect(readFileSync(out.assets[0]?.filePath ?? '')).toEqual(FAKE_WAV)

    const post = fetchImpl.mock.calls.find(([u]) => u.endsWith('/api/v3/tts/create'))?.[1]
    expect(JSON.parse(post?.body as string)).toMatchObject({
      model: 'seed-audio-1.0',
      text_prompt: '生成一段轻快的钢琴配乐',
      audio_config: { format: 'wav' },
    })
  })

  it('audio.music 业务错误: code!=0 抛错含码', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/api/v3/tts/create')) {
        return jsonRes({ code: 1004, message: '内容违规' })
      }
      throw new Error(`unexpected ${url}`)
    })
    await expect(
      new VolcengineSpeechMediaAdapter().invoke(
        makeInput({ capability: 'audio.music', outputDir: tmpDir }),
        makeContext({ fetch: fetchImpl, defaultModel: 'seed-audio-1.0' }),
      ),
    ).rejects.toThrow(/1004/)
  })

  it('audio.music 缺 url: code=0 但无 url → 抛 No audio url', async () => {
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/api/v3/tts/create')) return jsonRes({ code: 0 })
      throw new Error(`unexpected ${url}`)
    })
    await expect(
      new VolcengineSpeechMediaAdapter().invoke(
        makeInput({ capability: 'audio.music', outputDir: tmpDir }),
        makeContext({ fetch: fetchImpl, defaultModel: 'seed-audio-1.0' }),
      ),
    ).rejects.toThrow(/No audio url/)
  })

  it('supports 仅声明 audio.music / audio.speech', () => {
    const adapter = new VolcengineSpeechMediaAdapter()
    expect(adapter.supports('audio.music')).toBe(true)
    expect(adapter.supports('audio.speech')).toBe(true)
    expect(adapter.supports('image.generate')).toBe(false)
    expect(adapter.supports('video.generate')).toBe(false)
  })
})
