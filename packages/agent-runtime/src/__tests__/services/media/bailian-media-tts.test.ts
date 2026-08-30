import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { BailianMediaAdapter } from '../../../services/media/adapters/bailian-media.adapter.js'
import type {
  MediaGenerateInput,
  MediaProviderContext,
} from '../../../services/media/media-adapter.types.js'
import {
  BUILTIN_MEDIA_MODEL_MANIFESTS,
  type MediaModelManifest,
} from '@spark/protocol'

const ENDPOINT = 'https://dashscope.aliyuncs.com'

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

// ID3v2 头（音频测试用，非合法完整 mp3，仅用于落盘 buffer 比对）
const FAKE_MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x10, 0x00, 0x00, 0x00, 0x20, 0x53])

function makeContext(overrides: Partial<MediaProviderContext>): MediaProviderContext {
  return {
    apiKey: 'sk-test',
    apiEndpoint: ENDPOINT,
    defaultModel: 'qwen3-tts-flash',
    mediaProvider: 'bailian',
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

function manifestContext(
  id: string,
  overrides: Partial<MediaProviderContext> = {},
): MediaProviderContext {
  const manifest = findManifest(id)
  const capability = manifest.capabilities.find((item) => item.id === 'audio.speech')
  if (!capability) throw new Error(`${id} audio.speech capability not found`)
  return makeContext({
    defaultModel: manifest.modelId,
    mediaManifest: manifest,
    mediaManifestCapability: capability,
    ...overrides,
  })
}

describe('BailianMediaAdapter — audio.speech (TTS)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bailian-tts-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('两个 TTS manifest 已注册（qwen3-tts-flash / cosyvoice-v3.5-flash）', () => {
    const ids = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (m) => m.id === 'bailian:qwen3-tts-flash' || m.id === 'bailian:cosyvoice-v3.5-flash',
    ).map((m) => m.id)
    expect(ids).toEqual(
      expect.arrayContaining(['bailian:qwen3-tts-flash', 'bailian:cosyvoice-v3.5-flash']),
    )
  })

  it('Qwen-TTS: POST /multimodal-generation/generation，output.audio.url 落盘', async () => {
    let submitted: Record<string, unknown> | undefined
    let capturedUrl: string | undefined
    const fetchImpl = mockFetch(async (url, init) => {
      if (url.endsWith('/multimodal-generation/generation')) {
        capturedUrl = url
        submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonRes({
          status_code: 200,
          request_id: 'qwen-tts-1',
          code: '',
          message: '',
          output: {
            finish_reason: 'stop',
            audio: { data: '', url: 'https://cdn/qwen.wav', id: 'audio-1', expires_at: 0 },
          },
          usage: { input_tokens: 0, output_tokens: 0, characters: 5 },
        })
      }
      if (url === 'https://cdn/qwen.wav') return binaryRes(FAKE_MP3)
      throw new Error(`unexpected fetch ${url}`)
    })
    const ctx = manifestContext('bailian:qwen3-tts-flash', {
      fetch: fetchImpl,
      mediaDefaults: { audio: { voice: 'Cherry' } },
    })

    const result = await new BailianMediaAdapter().invoke(
      makeInput({ prompt: '你好世界', outputDir: tmpDir }),
      ctx,
    )

    // 请求体严格按 §2.3 / §2.4：input 为对象，含 text/voice
    expect(submitted).toMatchObject({
      model: 'qwen3-tts-flash',
      input: { text: '你好世界', voice: 'Cherry' },
    })
    // Qwen-TTS endpoint 必须落在 /api/v1/services/aigc/multimodal-generation/generation（§2.1）
    expect(capturedUrl).toMatch(/\/services\/aigc\/multimodal-generation\/generation$/)
    // Qwen-TTS 不应携带 format/speed（§2.4 无此字段）
    expect((submitted as { input?: Record<string, unknown> }).input).not.toHaveProperty('format')
    expect((submitted as { input?: Record<string, unknown> }).input).not.toHaveProperty('speed')
    expect(result.assets).toHaveLength(1)
    expect(readFileSync(result.assets[0]!.filePath!)).toEqual(FAKE_MP3)
    expect(result.mode).toBe('sync')
  })

  it('Qwen-TTS: language_type 透传到 input', async () => {
    let submitted: Record<string, unknown> | undefined
    const fetchImpl = mockFetch(async (url, init) => {
      if (url.endsWith('/multimodal-generation/generation')) {
        submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonRes({
          output: { audio: { url: 'https://cdn/q2.wav' } },
        })
      }
      if (url === 'https://cdn/q2.wav') return binaryRes(FAKE_MP3)
      throw new Error(`unexpected ${url}`)
    })
    const ctx = manifestContext('bailian:qwen3-tts-flash', {
      fetch: fetchImpl,
      mediaDefaults: { audio: { voice: 'Cherry' } },
    })
    await new BailianMediaAdapter().invoke(
      makeInput({ prompt: 'hello', outputDir: tmpDir, modelParams: { language_type: 'English' } }),
      ctx,
    )
    expect(submitted).toMatchObject({ input: { language_type: 'English' } })
  })

  it('CosyVoice: POST /audio/tts/SpeechSynthesizer，body 含 format/sample_rate/volume', async () => {
    let submitted: Record<string, unknown> | undefined
    let capturedUrl: string | undefined
    const fetchImpl = mockFetch(async (url, init) => {
      if (url.endsWith('/audio/tts/SpeechSynthesizer')) {
        capturedUrl = url
        submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return jsonRes({
          request_id: 'cosy-1',
          output: { finish_reason: 'stop', audio: { url: 'https://cdn/cosy.mp3' } },
          usage: { characters: 5 },
        })
      }
      if (url === 'https://cdn/cosy.mp3') return binaryRes(FAKE_MP3)
      throw new Error(`unexpected ${url}`)
    })
    const ctx = manifestContext('bailian:cosyvoice-v3.5-flash', {
      fetch: fetchImpl,
      mediaDefaults: { audio: { voice: 'longanhuan_v3.6' } },
    })

    const result = await new BailianMediaAdapter().invoke(
      makeInput({
        prompt: '你好',
        outputDir: tmpDir,
        modelParams: { format: 'wav', sample_rate: 24000, volume: 60, rate: 1.1 },
      }),
      ctx,
    )

    // 请求体严格按 §3.3 / §3.4
    expect(submitted).toMatchObject({
      model: 'cosyvoice-v3.5-flash',
      input: {
        text: '你好',
        voice: 'longanhuan_v3.6',
        format: 'wav',
        sample_rate: 24000,
        volume: 60,
        rate: 1.1,
      },
    })
    // CosyVoice endpoint 必须落在 /api/v1/services/audio/tts/SpeechSynthesizer（§3.1）
    // apiV1BaseUrl 已去掉 /services/aigc 得到 /api/v1，需补 /services/ 段，否则 404
    expect(capturedUrl).toMatch(/\/services\/audio\/tts\/SpeechSynthesizer$/)
    expect(result.assets).toHaveLength(1)
    expect(readFileSync(result.assets[0]!.filePath!)).toEqual(FAKE_MP3)
  })

  it('voice 缺失抛错（modelParams 与 mediaDefaults 都无 voice）', async () => {
    const fetchImpl = mockFetch(async () => jsonRes({}))
    const ctx = manifestContext('bailian:qwen3-tts-flash', { fetch: fetchImpl })
    await expect(
      new BailianMediaAdapter().invoke(makeInput({ prompt: 'hi', outputDir: tmpDir }), ctx),
    ).rejects.toThrow('voice')
  })

  it('dashscope 错误归一（code/message/request_id）', async () => {
    const fetchImpl = mockFetch(async () =>
      jsonRes(
        { code: 'InvalidApiKey', message: 'Invalid API-key in Authorization', request_id: 'err-1' },
        400,
      ),
    )
    const ctx = manifestContext('bailian:qwen3-tts-flash', {
      fetch: fetchImpl,
      mediaDefaults: { audio: { voice: 'Cherry' } },
    })
    await expect(
      new BailianMediaAdapter().invoke(makeInput({ prompt: 'hi', outputDir: tmpDir }), ctx),
    ).rejects.toThrow('InvalidApiKey')
  })

  it('响应缺 output.audio.url 抛错', async () => {
    const fetchImpl = mockFetch(async () => jsonRes({ request_id: 'x', output: {} }))
    const ctx = manifestContext('bailian:qwen3-tts-flash', {
      fetch: fetchImpl,
      mediaDefaults: { audio: { voice: 'Cherry' } },
    })
    await expect(
      new BailianMediaAdapter().invoke(makeInput({ prompt: 'hi', outputDir: tmpDir }), ctx),
    ).rejects.toThrow('No audio url')
  })
})
