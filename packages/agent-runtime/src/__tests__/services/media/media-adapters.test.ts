import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MediaRouterService } from '../../../services/media/media-router.service.js'
import type { MediaProviderProfile } from '../../../services/media/media-router.service.js'
import { ApimartMediaAdapter } from '../../../services/media/adapters/apimart-media.adapter.js'
import { XaiMediaAdapter } from '../../../services/media/adapters/xai-media.adapter.js'
import { MediaProviderError } from '../../../services/media/media-adapter.types.js'
import {
  extractImages,
  extractMediaUrls,
  extractTaskId,
  extractText,
} from '../../../services/media/media-http.util.js'
import { capabilityForOperation, BUILTIN_MEDIA_MODEL_MANIFESTS, type MediaModelManifest } from '@spark/protocol'

// ─── 测试 fixtures ─────────────────────────────────────────────────────────

const PNG_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const APIMART_ENDPOINT = 'https://api.apimart.ai/v1'
const XAI_ENDPOINT = 'https://api.x.ai/v1'

function makeProvider(overrides: Partial<MediaProviderProfile> = {}): MediaProviderProfile {
  return {
    id: 'prov-1',
    name: 'APIMart Media',
    defaultModel: 'gpt-image-2',
    apiEndpoint: APIMART_ENDPOINT,
    mediaProvider: 'apimart',
    mediaApiType: 'auto',
    mediaCapabilities: ['image.generate', 'image.edit', 'audio.speech', 'audio.transcription', 'video.generate'],
    apiKey: 'sk-test',
    ...overrides,
  }
}

/** 构造一个 mock fetch：按 path 精确路由，支持多次轮询调用计数。
 *  路由按 match 字符串长度降序匹配，避免 /videos/generations 抢走 /videos/generations/{id} 的请求。 */
function makeFetch(routes: Array<{ match: string; respond: (init: RequestInit | undefined, count: number) => { ok: boolean; status: number; body: unknown; binary?: Buffer } }>): typeof fetch & { calls: Array<{ url: string; method?: string }> } {
  const ordered = [...routes].sort((a, b) => b.match.length - a.match.length)
  const calls: Array<{ url: string; method?: string }> = []
  const counter = new Map<string, number>()
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    const count = (counter.get(url) ?? 0) + 1
    counter.set(url, count)
    const route = ordered.find((entry) => url.includes(entry.match))
    if (!route) {
      return new Response(JSON.stringify({ error: `no route for ${url}` }), { status: 404 })
    }
    const { ok, status, body, binary } = route.respond(init, count)
    if (binary) {
      return new Response(new Uint8Array(binary), { status })
    }
    return new Response(body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body), {
      status: ok === false ? (status || 500) : status,
    })
  }) as typeof fetch
  return Object.assign(impl, { calls }) as typeof fetch & { calls: Array<{ url: string; method?: string }> }
}

describe('media HTTP util extractors', () => {
  it('extractImages pulls urls and base64 from nested payloads', () => {
    const images = extractImages({
      data: [{ url: 'https://cdn/a.png' }, { b64_json: PNG_PIXEL }],
      nested: { image_url: 'https://cdn/b.png' },
    })
    expect(images).toHaveLength(3)
    expect(images.some((image) => image.kind === 'url' && image.value === 'https://cdn/a.png')).toBe(true)
    expect(images.some((image) => image.kind === 'base64')).toBe(true)
  })

  it('extractMediaUrls dedupes video urls', () => {
    const urls = extractMediaUrls({ video_url: 'https://cdn/v.mp4', result: { url: 'https://cdn/v.mp4' } }, { kind: 'video' })
    expect(urls).toEqual(['https://cdn/v.mp4'])
  })

  it('extractTaskId prefers task_id then request_id then id', () => {
    expect(extractTaskId({ id: 'i1', request_id: 'r1', task_id: 't1' })).toBe('t1')
    expect(extractTaskId({ data: { request_id: 'r1' } })).toBe('r1')
    expect(extractTaskId({ id: 'i1' })).toBe('i1')
    expect(extractTaskId({})).toBe('')
  })

  it('extractText joins text fields', () => {
    expect(extractText({ text: 'a' })).toBe('a')
    expect(extractText({ segments: [{ transcript: 'x' }, { transcript: 'y' }] })).toBe('x\ny')
  })
})

describe('capabilityForOperation mapping', () => {
  it('maps canvas operations to capabilities', () => {
    expect(capabilityForOperation('text_to_image')).toEqual(['image.generate'])
    expect(capabilityForOperation('text_to_audio')).toEqual(['audio.speech'])
    expect(capabilityForOperation('audio_transcribe')).toEqual(['audio.transcription'])
    expect(capabilityForOperation('text_to_video')).toEqual(['video.generate'])
    expect(capabilityForOperation('image_to_video')).toEqual(['video.image_to_video'])
    expect(capabilityForOperation('video_edit')).toEqual(['video.edit'])
    expect(capabilityForOperation('video_extend')).toEqual(['video.extend'])
    expect(capabilityForOperation('image_to_image')).toContain('image.edit')
  })
})

describe('MediaRouterService', () => {
  let router: MediaRouterService
  let tmpDir: string

  beforeEach(() => {
    router = new MediaRouterService()
    tmpDir = path.join(os.tmpdir(), `spark-media-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    vi.unstubAllGlobals()
  })

  it('registers APIMart and xAI adapters', () => {
    expect(router.listAdapters()).toEqual(expect.arrayContaining(['apimart', 'xai']))
    expect(router.getAdapter('apimart')).toBeInstanceOf(ApimartMediaAdapter)
    expect(router.getAdapter('xai')).toBeInstanceOf(XaiMediaAdapter)
  })

  it('resolveCapability returns the capability required by an operation', () => {
    const providers = [makeProvider({ mediaCapabilities: ['image.generate'] })]
    // text_to_image is supported by the provider
    expect(router.resolveCapability('text_to_image', providers)).toBe('image.generate')
    // text_to_video requires video.generate; no provider declares it, but resolveCapability
    // still returns the required capability (availability is checked in invoke()).
    expect(router.resolveCapability('text_to_video', providers)).toBe('video.generate')
    // with no providers, returns the first candidate derived from the operation
    expect(router.resolveCapability('text_to_image', [])).toBe('image.generate')
  })

  it('throws provider_not_configured when no providers', async () => {
    await expect(
      router.invoke(
        { operation: 'text_to_image', capability: 'image.generate', outputDir: tmpDir, prompt: 'cat' },
        { providers: [] },
      ),
    ).rejects.toMatchObject({ code: 'provider_not_configured' })
  })

  it('throws capability_not_supported when no provider supports the capability', async () => {
    const provider = makeProvider({ mediaCapabilities: ['image.generate'] })
    await expect(
      router.invoke(
        { operation: 'text_to_video', capability: 'video.generate', outputDir: tmpDir, prompt: 'cat' },
        { providers: [provider] },
      ),
    ).rejects.toMatchObject({ code: 'capability_not_supported' })
  })

  it('throws api_key_missing when provider has no key', async () => {
    const provider = makeProvider({ apiKey: '' })
    await expect(
      router.invoke(
        { operation: 'text_to_image', capability: 'image.generate', outputDir: tmpDir, prompt: 'cat' },
        { providers: [provider] },
      ),
    ).rejects.toMatchObject({ code: 'api_key_missing' })
  })

  it('APIMart image.generate (sync): writes image to disk', async () => {
    const fetchMock = makeFetch([
      { match: '/images/generations', respond: () => ({ ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }) },
    ])
    const { output } = await router.invoke(
      { operation: 'text_to_image', capability: 'image.generate', outputDir: tmpDir, prompt: 'a red apple' },
      { providers: [makeProvider()], fetch: fetchMock },
    )
    expect(output.mode).toBe('sync')
    expect(output.assets).toHaveLength(1)
    expect(output.assets[0]?.type).toBe('image')
    const filePath = output.assets[0]?.filePath
    expect(filePath).toBeTruthy()
    expect(existsSync(filePath!)).toBe(true)
  })

  it('APIMart image.generate (async): polls task then downloads url', async () => {
    const fetchMock = makeFetch([
      { match: '/images/generations', respond: () => ({ ok: true, status: 200, body: { task_id: 'task-123' } }) },
      { match: '/tasks/task-123', respond: (_init, count) =>
        count >= 2
          ? { ok: true, status: 200, body: { status: 'completed', data: [{ url: 'https://cdn/img.png' }] } }
          : { ok: true, status: 200, body: { status: 'processing' } } },
      { match: 'https://cdn/img.png', respond: () => ({ ok: true, status: 200, body: null, binary: Buffer.from(PNG_PIXEL, 'base64') }) },
    ])
    const { output } = await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        outputDir: tmpDir,
        prompt: 'a blue car',
        modelParams: { filename: 'car' },
      },
      {
        providers: [makeProvider({ mediaDefaults: { polling: { intervalMs: 1, timeoutMs: 5_000 } } })],
        fetch: fetchMock,
      },
    )
    expect(output.mode).toBe('async')
    expect(output.requestId).toBe('task-123')
    const filePath = output.assets[0]?.filePath
    expect(filePath).toContain('car')
    expect(existsSync(filePath!)).toBe(true)
    expect(fetchMock.calls.some((call) => call.url.includes('/tasks/task-123'))).toBe(true)
  })

  it('APIMart image.generate maps aspect_ratio to vertical size instead of default square size', async () => {
    const captured: { body: Record<string, unknown> } = { body: {} }
    const fetchMock = makeFetch([
      {
        match: '/images/generations',
        respond: (init) => {
          captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
        },
      },
    ])

    await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        outputDir: tmpDir,
        prompt: 'portrait poster',
        modelParams: { aspect_ratio: '9:16' },
      },
      {
        providers: [makeProvider({ mediaDefaults: { image: { n: 1, size: '1024x1024' } } })],
        fetch: fetchMock,
      },
    )

    expect(captured.body.size).toBe('1024x1536')
    expect(captured.body.aspect_ratio).toBeUndefined()
  })

  it('APIMart audio.speech: writes binary audio to disk', async () => {
    const audioBuf = Buffer.from([0x49, 0x44, 0x33, 0x04]) // fake mp3 header
    const fetchMock = makeFetch([
      { match: '/audio/speech', respond: () => ({ ok: true, status: 200, body: null, binary: audioBuf }) },
    ])
    const { output } = await router.invoke(
      { operation: 'text_to_audio', capability: 'audio.speech', outputDir: tmpDir, prompt: 'hello world' },
      {
        providers: [makeProvider({ defaultModel: 'tts-1', mediaDefaults: { audio: { voice: 'alloy', format: 'mp3' } } })],
        fetch: fetchMock,
      },
    )
    expect(output.assets[0]?.type).toBe('audio')
    expect(output.assets[0]?.mimeType).toBe('audio/mpeg')
    expect(readFileSync(output.assets[0]!.filePath!)).toEqual(audioBuf)
  })

  it('APIMart audio.transcription: writes text asset', async () => {
    const fetchMock = makeFetch([
      { match: '/audio/transcriptions', respond: () => ({ ok: true, status: 200, body: { text: 'transcribed words' } }) },
    ])
    const { output } = await router.invoke(
      {
        operation: 'audio_transcribe',
        capability: 'audio.transcription',
        outputDir: tmpDir,
        inputFiles: [{ type: 'audio', url: 'https://example/audio.mp3' }],
      },
      {
        providers: [makeProvider({ defaultModel: 'whisper-1' })],
        fetch: fetchMock,
      },
    )
    expect(output.assets[0]?.type).toBe('text')
    expect(output.assets[0]?.contentText).toBe('transcribed words')
  })

  it('APIMart video.generate (async): polls then downloads video url', async () => {
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]) // ftyp box
    const fetchMock = makeFetch([
      { match: '/videos/generations', respond: (init) => init?.method === 'POST' ? { ok: true, status: 200, body: { id: 'vid-1', status: 'pending' } } : { ok: true, status: 200, body: { id: 'vid-1' } } },
      { match: '/videos/generations/vid-1', respond: (_init, count) =>
        count >= 2
          ? { ok: true, status: 200, body: { status: 'completed', video: { url: 'https://cdn/v.mp4' } } }
          : { ok: true, status: 200, body: { status: 'generating' } } },
      { match: 'https://cdn/v.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])
    const { output } = await router.invoke(
      { operation: 'text_to_video', capability: 'video.generate', outputDir: tmpDir, prompt: 'sunset timelapse' },
      {
        providers: [makeProvider({ defaultModel: 'veo3', mediaDefaults: { polling: { intervalMs: 1, timeoutMs: 5_000 } } })],
        fetch: fetchMock,
      },
    )
    expect(output.mode).toBe('async')
    expect(output.requestId).toBe('vid-1')
    expect(output.assets[0]?.type).toBe('video')
    expect(readFileSync(output.assets[0]!.filePath!)).toEqual(videoBuf)
  })

  it('task failure raises task_failed error', async () => {
    const fetchMock = makeFetch([
      { match: '/videos/generations', respond: () => ({ ok: true, status: 200, body: { id: 'vid-fail' } }) },
      { match: '/videos/generations/vid-fail', respond: () => ({ ok: true, status: 200, body: { status: 'failed' } }) },
    ])
    await expect(
      router.invoke(
        { operation: 'text_to_video', capability: 'video.generate', outputDir: tmpDir, prompt: 'x' },
        {
          providers: [makeProvider({ defaultModel: 'veo3', mediaDefaults: { polling: { intervalMs: 1, timeoutMs: 2_000 } } })],
          fetch: fetchMock,
        },
      ),
    ).rejects.toMatchObject({ code: 'task_failed' })
  })

  it('xAI image.generate (sync): writes image', async () => {
    const fetchMock = makeFetch([
      { match: '/images/generations', respond: () => ({ ok: true, status: 200, body: { data: [{ url: 'https://cdn/xai.png' }] } }) },
      { match: 'https://cdn/xai.png', respond: () => ({ ok: true, status: 200, body: null, binary: Buffer.from(PNG_PIXEL, 'base64') }) },
    ])
    const { output } = await router.invoke(
      { operation: 'text_to_image', capability: 'image.generate', outputDir: tmpDir, prompt: 'grok art' },
      {
        providers: [makeProvider({
          id: 'xai-1',
          name: 'xAI Imagine',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          defaultModel: 'grok-imagine-image',
          mediaCapabilities: ['image.generate'],
        })],
        fetch: fetchMock,
      },
    )
    expect(output.provider).toBe('xai')
    expect(existsSync(output.assets[0]!.filePath!)).toBe(true)
  })

  it('xAI grok-imagine-video image_to_video uses image.url and polls video output', async () => {
    const captured: { body: Record<string, unknown> } = { body: {} }
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const fetchMock = makeFetch([
      { match: '/videos/xai-video-1', respond: (_init, count) =>
        count >= 2
          ? { ok: true, status: 200, body: { status: 'completed', video_url: 'https://cdn/xai-video.mp4' } }
          : { ok: true, status: 200, body: { status: 'processing' } } },
      { match: '/videos/generations', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return { ok: true, status: 200, body: { request_id: 'xai-video-1' } }
      } },
      { match: 'https://cdn/xai-video.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])

    const { output } = await router.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        outputDir: tmpDir,
        prompt: 'animate this product shot',
        inputFiles: [
          {
            type: 'image',
            url: 'safe-file://x/not-for-provider',
            dataUrl: `data:image/png;base64,${PNG_PIXEL}`,
          },
        ],
        modelParams: { durationSeconds: 8, resolution: '720p', seed: 42 },
      },
      {
        providers: [makeProvider({
          id: 'xai-video',
          name: 'xAI Imagine Video',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          mediaApiType: 'async',
          defaultModel: 'grok-imagine-video',
          mediaCapabilities: ['video.generate', 'video.image_to_video'],
          mediaDefaults: {
            video: { aspectRatio: '9:16', quality: 'hd' },
            polling: { intervalMs: 1, timeoutMs: 5_000 },
          },
        })],
        fetch: fetchMock,
      },
    )

    expect(captured.body).toMatchObject({
      model: 'grok-imagine-video',
      prompt: 'animate this product shot',
      image: { url: `data:image/png;base64,${PNG_PIXEL}` },
      aspect_ratio: '9:16',
      duration: 8,
      quality: 'hd',
      resolution: '720p',
      seed: 42,
    })
    expect(captured.body.image_url).toBeUndefined()
    expect(output.provider).toBe('xai')
    expect(output.mode).toBe('async')
    expect(output.requestId).toBe('xai-video-1')
    expect(readFileSync(output.assets[0]!.filePath!)).toEqual(videoBuf)
  })

  it('xAI grok-imagine-video video_edit posts to /videos/edits with video object (ignores duration/aspect/resolution)', async () => {
    // 官方明确：视频编辑走独立端点 POST /videos/edits，body 为 { model, prompt, video:{url} }，
    // 输出继承输入视频的 duration/aspect_ratio/resolution（这些参数被忽略）。
    const captured: { body: Record<string, unknown>; url: string } = { body: {}, url: '' }
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const fetchMock = makeFetch([
      { match: '/videos/xai-edit-1', respond: () =>
        ({ ok: true, status: 200, body: { status: 'done', video: { url: 'https://cdn/xai-edited.mp4', duration: 5 } } }) },
      { match: '/videos/edits', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        captured.url = '/videos/edits'
        return { ok: true, status: 200, body: { request_id: 'xai-edit-1' } }
      } },
      { match: 'https://cdn/xai-edited.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])

    const { output } = await router.invoke(
      {
        operation: 'video_edit',
        capability: 'video.edit',
        outputDir: tmpDir,
        prompt: 'make the motion smoother',
        inputFiles: [
          { type: 'video', role: 'input', url: 'https://cdn/source.mp4' },
        ],
        // 编辑端点忽略这些参数；即便传入也不应出现在 body 中
        modelParams: { editStrength: 0.6, durationSeconds: 10, aspectRatio: '9:16', resolution: '1080p' },
      },
      {
        providers: [makeProvider({
          id: 'xai-video',
          name: 'xAI Imagine Video',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          mediaApiType: 'async',
          defaultModel: 'grok-imagine-video',
          mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit', 'video.extend'],
          mediaDefaults: {
            polling: { intervalMs: 1, timeoutMs: 5_000 },
          },
        })],
        fetch: fetchMock,
      },
    )

    // body 仅含 model/prompt/video；duration/aspect_ratio/resolution/edit_strength 不应出现
    expect(captured.url).toBe('/videos/edits')
    expect(captured.body).toMatchObject({
      model: 'grok-imagine-video',
      prompt: 'make the motion smoother',
      video: { url: 'https://cdn/source.mp4' },
    })
    expect(captured.body).not.toHaveProperty('duration')
    expect(captured.body).not.toHaveProperty('aspect_ratio')
    expect(captured.body).not.toHaveProperty('resolution')
    expect(captured.body).not.toHaveProperty('edit_strength')
    expect(captured.body).not.toHaveProperty('image')
    expect(output.provider).toBe('xai')
    expect(output.mode).toBe('async')
    expect(output.requestId).toBe('xai-edit-1')
    expect(readFileSync(output.assets[0]!.filePath!)).toEqual(videoBuf)
  })

  it('xAI grok-imagine-video video_extend posts to /videos/extensions with clamped duration', async () => {
    // 官方明确：视频扩展走 POST /videos/extensions，duration 范围 [1,15] 默认 6，
    // 从输入视频最后一帧续拍。超出范围的 duration 应被 clamp。
    const captured: { body: Record<string, unknown>; url: string } = { body: {}, url: '' }
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const fetchMock = makeFetch([
      { match: '/videos/xai-ext-1', respond: () =>
        ({ ok: true, status: 200, body: { status: 'done', video: { url: 'https://cdn/xai-extended.mp4', duration: 6 } } }) },
      { match: '/videos/extensions', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        captured.url = '/videos/extensions'
        return { ok: true, status: 200, body: { request_id: 'xai-ext-1' } }
      } },
      { match: 'https://cdn/xai-extended.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])

    const { output } = await router.invoke(
      {
        operation: 'video_edit',
        capability: 'video.extend',
        outputDir: tmpDir,
        prompt: 'continue the rocket launch upward',
        inputFiles: [
          { type: 'video', role: 'input', url: 'https://cdn/source.mp4' },
        ],
        // duration=30 超出 [1,15]，应 clamp 到 15
        modelParams: { durationSeconds: 30 },
      },
      {
        providers: [makeProvider({
          id: 'xai-video-2',
          name: 'xAI Imagine Video',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          mediaApiType: 'async',
          defaultModel: 'grok-imagine-video',
          mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit', 'video.extend'],
          mediaDefaults: {
            polling: { intervalMs: 1, timeoutMs: 5_000 },
          },
        })],
        fetch: fetchMock,
      },
    )

    expect(captured.url).toBe('/videos/extensions')
    expect(captured.body).toMatchObject({
      model: 'grok-imagine-video',
      prompt: 'continue the rocket launch upward',
      video: { url: 'https://cdn/source.mp4' },
      duration: 15,
    })
    expect(output.provider).toBe('xai')
    expect(output.mode).toBe('async')
    expect(output.requestId).toBe('xai-ext-1')
    expect(readFileSync(output.assets[0]!.filePath!)).toEqual(videoBuf)
  })

  it('xAI video.extend requires an input video', async () => {
    const fetchMock = makeFetch([])
    await expect(router.invoke(
      {
        operation: 'video_edit',
        capability: 'video.extend',
        outputDir: tmpDir,
        prompt: 'continue',
        inputFiles: [],
      },
      {
        providers: [makeProvider({
          id: 'xai-video-3',
          name: 'xAI Imagine Video',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          mediaApiType: 'async',
          defaultModel: 'grok-imagine-video',
          mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit', 'video.extend'],
        })],
        fetch: fetchMock,
      },
    )).rejects.toThrow(/input video/)
  })

  it('APIMart image.edit uploads dataUrl input before generation', async () => {
    const fetchMock = makeFetch([
      { match: '/uploads/images', respond: () => ({ ok: true, status: 200, body: { data: [{ url: 'https://cdn/uploaded.png' }] } }) },
      { match: '/images/generations', respond: (init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        expect(body.image_urls).toEqual(['https://cdn/uploaded.png'])
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    const { output } = await router.invoke(
      {
        operation: 'image_edit',
        capability: 'image.edit',
        outputDir: tmpDir,
        prompt: 'refine this image',
        inputFiles: [{ type: 'image', dataUrl: `data:image/png;base64,${PNG_PIXEL}` }],
      },
      {
        providers: [makeProvider()],
        fetch: fetchMock,
      },
    )
    expect(output.provider).toBe('apimart')
    expect(fetchMock.calls.some((call) => call.url.includes('/uploads/images'))).toBe(true)
    expect(existsSync(output.assets[0]!.filePath!)).toBe(true)
  })

  it('xAI does not support audio.transcription', () => {
    const xai = new XaiMediaAdapter()
    expect(xai.supports('audio.transcription')).toBe(false)
    expect(xai.supports('audio.speech')).toBe(true)
    expect(xai.supports('video.reference_to_video')).toBe(true)
    expect(xai.supports('video.extend')).toBe(true)
  })

  it('xAI image.edit routes through /images/edits with image {url, type} (dataUrl)', async () => {
    // 用 holder 对象承载抓取到的 body/url，避免 CFA 把 let 变量收窄成 never。
    const captured: { body: Record<string, unknown>; url: string } = { body: {}, url: '' }
    const fetchMock = makeFetch([
      { match: '/images/edits', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        captured.url = '/images/edits'
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    const { output } = await router.invoke(
      {
        operation: 'image_edit',
        capability: 'image.edit',
        outputDir: tmpDir,
        prompt: 'cleanup',
        inputFiles: [{ type: 'image', dataUrl: `data:image/png;base64,${PNG_PIXEL}` }],
      },
      {
        providers: [makeProvider({
          id: 'xai-1',
          name: 'xAI Imagine',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          defaultModel: 'grok-imagine-image',
          mediaCapabilities: ['image.generate', 'image.edit'],
        })],
        fetch: fetchMock,
      },
    )
    expect(output.provider).toBe('xai')
    // xAI 编辑走 /images/edits，源图按 image（{url, type:"image_url"} 对象）传入。
    expect(captured.url).toBe('/images/edits')
    expect(captured.body.image).toEqual({
      url: `data:image/png;base64,${PNG_PIXEL}`,
      type: 'image_url',
    })
    expect(captured.body.images).toBeUndefined()
    expect(captured.body.image_url).toBeUndefined()
    expect(existsSync(output.assets[0]!.filePath!)).toBe(true)
  })

  it('xAI image.edit uses images array for multiple inputs', async () => {
    const captured: { body: Record<string, unknown> } = { body: {} }
    const fetchMock = makeFetch([
      { match: '/images/edits', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    await router.invoke(
      {
        operation: 'image_edit',
        capability: 'image.edit',
        outputDir: tmpDir,
        prompt: 'combine these',
        inputFiles: [
          { type: 'image', url: 'https://cdn/a.png' },
          { type: 'image', url: 'https://cdn/b.png' },
        ],
      },
      {
        providers: [makeProvider({
          id: 'xai-1',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          defaultModel: 'grok-imagine-image',
          mediaCapabilities: ['image.generate', 'image.edit'],
        })],
        fetch: fetchMock,
      },
    )
    expect(captured.body.images).toEqual([
      { url: 'https://cdn/a.png', type: 'image_url' },
      { url: 'https://cdn/b.png', type: 'image_url' },
    ])
    expect(captured.body.image).toBeUndefined()
    expect(captured.body.image_url).toBeUndefined()
  })

  // ── 回归：safe-file:// 本地协议地址绝不能发往第三方 provider ──────────────────
  // 画布参考图 file.url 多为 safe-file://（渲染用），但 xAI 等第三方 API 无法访问本地协议。
  // adapter 取值必须：dataUrl 优先于 url，safe-file url 被过滤，避免泄漏给 image.url。
  it('xAI image.edit prefers dataUrl over safe-file url (regression: must not leak local protocol)', async () => {
    const captured: { body: Record<string, unknown> } = { body: {} }
    const fetchMock = makeFetch([
      { match: '/images/edits', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    await router.invoke(
      {
        operation: 'image_edit',
        capability: 'image.edit',
        outputDir: tmpDir,
        prompt: 'cleanup',
        // safe-file url 与 dataUrl 共存：dataUrl 必须胜出，绝不用 safe-file
        inputFiles: [
          {
            type: 'image',
            url: 'safe-file://x/not-for-provider',
            dataUrl: `data:image/png;base64,${PNG_PIXEL}`,
          },
        ],
      },
      {
        providers: [makeProvider({
          id: 'xai-1',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          defaultModel: 'grok-imagine-image',
          mediaCapabilities: ['image.generate', 'image.edit'],
        })],
        fetch: fetchMock,
      },
    )
    expect((captured.body.image as { url: string }).url).toBe(`data:image/png;base64,${PNG_PIXEL}`)
    expect(JSON.stringify(captured.body.image)).not.toContain('safe-file://')
  })

  it('xAI image.edit rejects safe-file-only input (no usable reference) instead of sending local protocol', async () => {
    const fetchMock = makeFetch([
      { match: '/images/edits', respond: () => ({ ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }) },
    ])
    const result = router.invoke(
      {
        operation: 'image_edit',
        capability: 'image.edit',
        outputDir: tmpDir,
        prompt: 'cleanup',
        // 仅 safe-file url，无 dataUrl/path：adapter 无法解析出可发往 provider 的引用
        inputFiles: [{ type: 'image', url: 'safe-file://x/only-local' }],
      },
      {
        providers: [makeProvider({
          id: 'xai-1',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          defaultModel: 'grok-imagine-image',
          mediaCapabilities: ['image.generate', 'image.edit'],
        })],
        fetch: fetchMock,
      },
    )
    await expect(result).rejects.toThrow()
    // 确保没有把本地协议地址发出去
    expect(fetchMock.calls.some((call) => call.url.includes('images/edits'))).toBe(false)
  })

  it('xAI image.edit passes through native params (aspect_ratio/resolution) from modelParams', async () => {
    const captured: { body: Record<string, unknown> } = { body: {} }
    const fetchMock = makeFetch([
      { match: '/images/edits', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    await router.invoke(
      {
        operation: 'image_edit',
        capability: 'image.edit',
        outputDir: tmpDir,
        prompt: 'wider',
        inputFiles: [{ type: 'image', url: 'https://cdn/a.png' }],
        modelParams: { aspect_ratio: '16:9', resolution: '2k', image_format: 'png' },
      },
      {
        providers: [makeProvider({
          id: 'xai-1',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          defaultModel: 'grok-imagine-image',
          mediaCapabilities: ['image.generate', 'image.edit'],
        })],
        fetch: fetchMock,
      },
    )
    expect((captured.body.image as { url: string }).url).toBe('https://cdn/a.png')
    expect(captured.body.aspect_ratio).toBe('16:9')
    expect(captured.body.resolution).toBe('2k')
    expect(captured.body.image_format).toBe('png')
  })

  it('xAI image.edit maps canvas camelCase params to native xAI fields', async () => {
    const captured: { body: Record<string, unknown> } = { body: {} }
    const fetchMock = makeFetch([
      { match: '/images/edits', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    await router.invoke(
      {
        operation: 'image_edit',
        capability: 'image.edit',
        outputDir: tmpDir,
        prompt: 'wider',
        inputFiles: [{ type: 'image', url: 'https://cdn/a.png' }],
        modelParams: { aspectRatio: '16:9', resolution: '2k', responseFormat: 'b64_json', outputFormat: 'png' },
      },
      {
        providers: [makeProvider({
          id: 'xai-1',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          defaultModel: 'grok-imagine-image-quality',
          mediaCapabilities: ['image.generate', 'image.edit'],
        })],
        fetch: fetchMock,
      },
    )
    expect(captured.body.aspect_ratio).toBe('16:9')
    expect(captured.body).not.toHaveProperty('aspectRatio')
    expect(captured.body.response_format).toBe('b64_json')
    expect(captured.body.image_format).toBe('png')
  })

  it('xAI video polling treats expired as a failed terminal state', async () => {
    const fetchMock = makeFetch([
      { match: '/videos/xai-expired-1', respond: () => ({ ok: true, status: 200, body: { status: 'expired', error: 'request expired' } }) },
      { match: '/videos/generations', respond: () => ({ ok: true, status: 200, body: { request_id: 'xai-expired-1' } }) },
    ])
    await expect(router.invoke(
      {
        operation: 'text_to_video',
        capability: 'video.generate',
        outputDir: tmpDir,
        prompt: 'sunset',
      },
      {
        providers: [makeProvider({
          id: 'xai-video-expired',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          mediaApiType: 'async',
          defaultModel: 'grok-imagine-video',
          mediaCapabilities: ['video.generate'],
          mediaDefaults: { polling: { intervalMs: 1, timeoutMs: 100 } },
        })],
        fetch: fetchMock,
      },
    )).rejects.toMatchObject({ code: 'task_failed' })
  })

  // ── image.generate 携带参考图（如全景图 panorama_360 接上游图）：不得静默丢弃 ──
  // panorama_360 / text_to_image 经 capabilityForOperation 映射到 image.generate，
  // 但 generateImage 端点本身只发 prompt；若节点接了上游参考图，必须把图转发给模型，
  // 否则产物与参考图无关（见画布「全景图」node 上游连线图被忽略的 bug）。
  it('APIMart image.generate forwards upstream reference image (panorama_360) instead of dropping it', async () => {
    const captured: { body: Record<string, unknown> } = { body: {} }
    const fetchMock = makeFetch([
      { match: '/images/generations', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    const { output } = await router.invoke(
      {
        operation: 'panorama_360',
        capability: 'image.generate',
        outputDir: tmpDir,
        prompt: '等距柱状全景',
        // 画布默认按视频帧语义给单张输入图打 first_frame —— image.generate 必须忽略 role、当参考图用
        inputFiles: [{ type: 'image', url: 'https://cdn/reference.png', role: 'first_frame' }],
      },
      { providers: [makeProvider()], fetch: fetchMock },
    )
    expect(output.provider).toBe('apimart')
    expect(captured.body.image_urls).toEqual(['https://cdn/reference.png'])
    expect(captured.body.prompt).toBe('等距柱状全景')
    expect(existsSync(output.assets[0]!.filePath!)).toBe(true)
  })

  it('xAI image.generate forwards upstream reference image via edits endpoint (image object)', async () => {
    const captured: { body: Record<string, unknown>; url: string } = { body: {}, url: '' }
    const fetchMock = makeFetch([
      { match: '/images/edits', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        captured.url = '/images/edits'
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    await router.invoke(
      {
        operation: 'panorama_360',
        capability: 'image.generate',
        outputDir: tmpDir,
        prompt: 'panorama',
        inputFiles: [{ type: 'image', url: 'https://cdn/ref.png', role: 'first_frame' }],
      },
      {
        providers: [makeProvider({
          id: 'xai-1',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          defaultModel: 'grok-imagine-image',
          mediaCapabilities: ['image.generate', 'image.edit'],
        })],
        fetch: fetchMock,
      },
    )
    // 带参考图的 image.generate 委托给 editImage，走 /images/edits + image {url, type} 对象
    expect(captured.url).toBe('/images/edits')
    expect(captured.body.image).toEqual({ url: 'https://cdn/ref.png', type: 'image_url' })
  })

  it('image.generate without input image stays a pure text-to-image call (no image field)', async () => {
    const captured: { body: Record<string, unknown> } = { body: {} }
    const fetchMock = makeFetch([
      { match: '/images/generations', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    await router.invoke(
      { operation: 'text_to_image', capability: 'image.generate', outputDir: tmpDir, prompt: 'a cat' },
      { providers: [makeProvider()], fetch: fetchMock },
    )
    expect(captured.body.prompt).toBe('a cat')
    expect(captured.body.image_urls).toBeUndefined()
    expect(captured.body.image_url).toBeUndefined()
    expect(captured.body.image).toBeUndefined()
  })

  it('returns requestCall with method/url/body and truncates base64 in the body', async () => {
    const longBase64 = `data:image/png;base64,${PNG_PIXEL.repeat(20)}`
    const fetchMock = makeFetch([
      { match: '/images/edits', respond: (init) => {
        // 校验发往 provider 的真实 body 仍是完整的 dataUrl（截断只发生在 requestCall 摘要里）
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
        expect((body.image as { url: string }).url).toBe(longBase64)
        return { ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }
      } },
    ])
    const { output } = await router.invoke(
      {
        operation: 'image_edit',
        capability: 'image.edit',
        outputDir: tmpDir,
        prompt: 'cleanup',
        inputFiles: [{ type: 'image', dataUrl: longBase64 }],
      },
      {
        providers: [makeProvider({
          id: 'xai-1',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          defaultModel: 'grok-imagine-image',
          mediaCapabilities: ['image.generate', 'image.edit'],
        })],
        fetch: fetchMock,
      },
    )
    expect(output.requestCall).toBeDefined()
    expect(output.requestCall?.method).toBe('POST')
    expect(output.requestCall?.url).toContain('/images/edits')
    const reqBody = output.requestCall?.body as Record<string, unknown>
    expect(reqBody.model).toBe('grok-imagine-image')
    expect(reqBody.prompt).toBe('cleanup')
    // requestCall 摘要里 base64 dataUrl 必须被截断（不能原样带回上千字符）；
    // image 是 {url, type} 对象，截断发生在 image.url 上。
    const summarized = String((reqBody.image as { url: string }).url)
    expect(summarized.startsWith('data:image/png')).toBe(true)
    expect(summarized.length).toBeLessThan(longBase64.length)
    expect(summarized).toContain('truncated')
  })

  it('provider_http_error on non-ok response', async () => {
    const fetchMock = makeFetch([
      { match: '/images/generations', respond: () => ({ ok: false, status: 401, body: { error: 'unauthorized' } }) },
    ])
    await expect(
      router.invoke(
        { operation: 'text_to_image', capability: 'image.generate', outputDir: tmpDir, prompt: 'x' },
        { providers: [makeProvider()], fetch: fetchMock },
      ),
    ).rejects.toBeInstanceOf(MediaProviderError)
  })

  it('attaches requestCall to the error even when the provider call fails (422)', async () => {
    const fetchMock = makeFetch([
      { match: '/images/generations', respond: () => ({ ok: false, status: 422, body: { error: 'expected struct ImageUrl' } }) },
    ])
    let err: MediaProviderError | null = null
    try {
      await router.invoke(
        { operation: 'text_to_image', capability: 'image.generate', outputDir: tmpDir, prompt: 'cat' },
        { providers: [makeProvider()], fetch: fetchMock },
      )
    } catch (e) {
      err = e instanceof MediaProviderError ? e : null
    }
    expect(err).toBeInstanceOf(MediaProviderError)
    expect(err?.requestCall).toBeDefined()
    expect(err?.requestCall?.url).toContain('/images/generations')
    expect((err?.requestCall?.body as Record<string, unknown>).prompt).toBe('cat')
  })

  it('respects explicit providerProfileId over capability match', async () => {
    const fetchMock = makeFetch([
      { match: '/images/generations', respond: () => ({ ok: true, status: 200, body: { data: [{ b64_json: PNG_PIXEL }] } }) },
    ])
    const first = makeProvider({ id: 'first', mediaCapabilities: ['image.generate'] })
    const second = makeProvider({ id: 'second', mediaCapabilities: ['image.generate'] })
    const { providerProfileId } = await router.invoke(
      { operation: 'text_to_image', capability: 'image.generate', outputDir: tmpDir, prompt: 'x' },
      { providers: [first, second], providerProfileId: 'second', fetch: fetchMock },
    )
    expect(providerProfileId).toBe('second')
  })

  it('uses manifest requestTemplate with selected modelId and parameter aliases', async () => {
    let postedBody: Record<string, unknown> | null = null
    const manifest: MediaModelManifest = {
      id: 'custom:image-template',
      providerKind: 'custom-platform',
      modelId: 'manifest-image-model',
      displayName: 'Template Image',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'], mimeTypes: ['image/png'] },
          paramSchema: {},
          defaults: { n: 1, size: '1024x1024' },
          aliases: { aspectRatio: 'aspect_ratio' },
        },
      ],
      invocation: {
        mode: 'sync',
        endpoint: '/template/images',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
      },
      docs: { sourceUrls: [] },
    }
    const fetchMock = makeFetch([
      {
        match: '/template/images',
        respond: (init) => {
          postedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: { data: [{ url: 'https://cdn/template.png' }] } }
        },
      },
      { match: 'https://cdn/template.png', respond: () => ({ ok: true, status: 200, body: null, binary: Buffer.from(PNG_PIXEL, 'base64') }) },
    ])

    const { output } = await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        outputDir: tmpDir,
        prompt: 'template cat',
        modelParams: { aspectRatio: '16:9', filename: 'template-cat' },
      },
      {
        providers: [makeProvider({ mediaProvider: 'custom', mediaCapabilities: [], mediaModelManifests: [manifest] })],
        modelId: 'provider-image-v2',
        fetch: fetchMock,
      },
    )

    expect(output.provider).toBe('custom-platform')
    expect(output.model).toBe('provider-image-v2')
    expect(postedBody).toMatchObject({
      model: 'provider-image-v2',
      prompt: 'template cat',
      aspect_ratio: '16:9',
      n: 1,
    })
    expect((postedBody as Record<string, unknown> | null)?.size).toBeUndefined()
    expect(existsSync(output.assets[0]!.filePath!)).toBe(true)
  })

  it('uses manifest task polling and materializes video results', async () => {
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const manifest: MediaModelManifest = {
      id: 'custom:video-template',
      providerKind: 'custom-platform',
      modelId: 'manifest-video-model',
      displayName: 'Template Video',
      domains: ['video'],
      capabilities: [
        {
          id: 'video.generate',
          label: '文生视频',
          input: { required: ['prompt'] },
          output: { types: ['video'], mimeTypes: ['video/mp4'] },
          paramSchema: {},
        },
      ],
      invocation: {
        mode: 'async_polling',
        endpoint: '/template/videos',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: {
          kind: 'task_poll',
          taskIdPaths: ['task_id'],
          statusEndpoint: '/template/videos/{{taskId}}',
          resultPaths: ['data[].url'],
        },
        polling: {
          intervalMs: 1,
          timeoutMs: 5_000,
          statusMap: { queued: 'queued', running: 'running', complete: 'succeeded', failed: 'failed' },
        },
      },
      docs: { sourceUrls: [] },
    }
    const fetchMock = makeFetch([
      { match: '/template/videos', respond: (init) => init?.method === 'POST'
        ? { ok: true, status: 200, body: { task_id: 'tpl-vid-1' } }
        : { ok: true, status: 200, body: { status: 'queued' } } },
      { match: '/template/videos/tpl-vid-1', respond: (_init, count) =>
        count >= 2
          ? { ok: true, status: 200, body: { status: 'complete', data: [{ url: 'https://cdn/template.mp4' }] } }
          : { ok: true, status: 200, body: { status: 'running' } } },
      { match: 'https://cdn/template.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])

    const { output } = await router.invoke(
      { operation: 'text_to_video', capability: 'video.generate', outputDir: tmpDir, prompt: 'template sunset' },
      {
        providers: [makeProvider({ mediaProvider: 'custom', mediaCapabilities: [], mediaModelManifests: [manifest] })],
        fetch: fetchMock,
      },
    )

    expect(output.mode).toBe('async')
    expect(output.requestId).toBe('tpl-vid-1')
    expect(output.assets[0]?.type).toBe('video')
    expect(readFileSync(output.assets[0]!.filePath!)).toEqual(videoBuf)
  })

  it('materializes manifest task_poll response when the first response already has a result', async () => {
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])
    const manifest: MediaModelManifest = {
      id: 'custom:immediate-video-template',
      providerKind: 'custom-platform',
      modelId: 'manifest-video-model',
      displayName: 'Immediate Template Video',
      domains: ['video'],
      capabilities: [
        {
          id: 'video.generate',
          label: '文生视频',
          input: { required: ['prompt'] },
          output: { types: ['video'], mimeTypes: ['video/mp4'] },
          paramSchema: {},
        },
      ],
      invocation: {
        mode: 'async_polling',
        endpoint: '/template/immediate-videos',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: {
          kind: 'task_poll',
          taskIdPaths: ['task_id'],
          statusEndpoint: '/template/immediate-videos/{{taskId}}',
          resultPaths: ['data[].url'],
        },
      },
      docs: { sourceUrls: [] },
    }
    const fetchMock = makeFetch([
      { match: '/template/immediate-videos', respond: () => ({ ok: true, status: 200, body: { data: [{ url: 'https://cdn/immediate.mp4' }] } }) },
      { match: 'https://cdn/immediate.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])

    const { output } = await router.invoke(
      { operation: 'text_to_video', capability: 'video.generate', outputDir: tmpDir, prompt: 'instant result' },
      {
        providers: [makeProvider({ mediaProvider: 'custom', mediaCapabilities: [], mediaModelManifests: [manifest] })],
        fetch: fetchMock,
      },
    )

    expect(output.requestId).toBeUndefined()
    expect(readFileSync(output.assets[0]!.filePath!)).toEqual(videoBuf)
    expect(fetchMock.calls.some((call) => call.url.includes('/template/immediate-videos/'))).toBe(false)
  })
})

// ─── 火山方舟（VolcengineArk）专用 adapter ─────────────────────────────────
// 验证 Seedance 视频构造的嵌套 content[] 数组结构（type+role），以及路由优先级：
// 当 mediaProvider='volcengine-ark' 且 adapter.supports(capability) 时，
// MediaRouterService 必须走专用 adapter 而非模板适配器。
describe('VolcengineArkMediaAdapter', () => {
  let router: MediaRouterService
  let tmpDir: string

  beforeEach(() => {
    router = new MediaRouterService()
    tmpDir = path.join(os.tmpdir(), `spark-volc-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    vi.unstubAllGlobals()
  })

  it('registers the volcengine-ark adapter and supports its capabilities', () => {
    expect(router.listAdapters()).toContain('volcengine-ark')
    const adapter = router.getAdapter('volcengine-ark')
    expect(adapter).toBeDefined()
    expect(adapter!.supports('video.generate')).toBe(true)
    expect(adapter!.supports('image.generate')).toBe(true)
    expect(adapter!.supports('video.extend')).toBe(true)
  })

  it('Seedance video.generate builds nested content[] with text + reference_image roles and polls task', async () => {
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const seedanceManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'volcengine:doubao-seedance-2-0-260128')!
    let postedBody: Record<string, unknown> = {}
    const fetchMock = makeFetch([
      {
        match: '/contents/generations/tasks',
        respond: (init) => {
          if (init?.method === 'POST') {
            postedBody = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
            return { ok: true, status: 200, body: { id: 'seedance-task-1' } }
          }
          return { ok: true, status: 200, body: { status: 'queued' } }
        },
      },
      {
        match: '/contents/generations/tasks/seedance-task-1',
        respond: (_init, count) =>
          count >= 2
            ? { ok: true, status: 200, body: { status: 'succeeded', content: { video_url: 'https://cdn/seedance.mp4' } } }
            : { ok: true, status: 200, body: { status: 'running' } },
      },
      { match: 'https://cdn/seedance.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])

    const { output } = await router.invoke(
      {
        operation: 'text_to_video',
        capability: 'video.generate',
        outputDir: tmpDir,
        prompt: '一只猫在草地上奔跑',
        inputFiles: [{ type: 'image', role: 'reference', url: 'https://cdn/cat-ref.png' }],
        // aspectRatio 用 schema 默认值 '智能比例'（中文 label），验证 adapter 翻译为 'adaptive'
        modelParams: { durationSeconds: 8, generateAudio: true, resolution: '720p', aspectRatio: '智能比例' },
      },
      {
        providers: [
          makeProvider({
            id: 'volc-prov',
            name: '火山 Seedance',
            defaultModel: 'doubao-seedance-2-0-260128',
            apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
            mediaProvider: 'volcengine-ark',
            mediaApiType: 'async',
            mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit', 'video.extend'],
            mediaModelManifests: [seedanceManifest],
            mediaDefaults: { polling: { intervalMs: 1, timeoutMs: 5_000 } },
          }),
        ],
        fetch: fetchMock,
      },
    )

    // 关键断言：请求体必须是 model + content[]（type+role 对象数组），不是扁平 prompt 字段。
    expect(postedBody.model).toBe('doubao-seedance-2-0-260128')
    expect(postedBody.prompt).toBeUndefined()
    const content = postedBody.content as Array<Record<string, unknown>>
    expect(Array.isArray(content)).toBe(true)
    // 第一个元素是文本
    expect(content[0]).toMatchObject({ type: 'text', text: '一只猫在草地上奔跑' })
    // 参考图元素：type=image_url + role=reference_image + image_url.url
    const refImage = content.find((item) => item.type === 'image_url') as Record<string, unknown> | undefined
    expect(refImage).toBeDefined()
    expect(refImage!.role).toBe('reference_image')
    expect((refImage!.image_url as { url: string }).url).toBe('https://cdn/cat-ref.png')
    // 顶层参数（snake_case）
    expect(postedBody.duration).toBe(8)
    expect(postedBody.generate_audio).toBe(true)
    expect(postedBody.resolution).toBe('720p')
    // 关键：中文 label '智能比例' 必须在 adapter 层翻译为平台值 'adaptive'
    expect(postedBody.ratio).toBe('adaptive')
    // 不应出现模板适配器的扁平字段
    expect(postedBody.first_frame_image).toBeUndefined()
    expect(postedBody.image_urls).toBeUndefined()

    // 异步轮询 + 产物落盘
    expect(output.mode).toBe('async')
    expect(output.requestId).toBe('seedance-task-1')
    expect(output.assets[0]?.type).toBe('video')
    expect(readFileSync(output.assets[0]!.filePath!)).toEqual(videoBuf)
  })

  it('Seedance image_to_video treats the first image as first_frame role', async () => {
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const seedanceManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'volcengine:doubao-seedance-2-0-260128')!
    let postedBody: Record<string, unknown> = {}
    const fetchMock = makeFetch([
      {
        match: '/contents/generations/tasks',
        respond: (init) => {
          if (init?.method === 'POST') {
            postedBody = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
            return { ok: true, status: 200, body: { id: 'i2v-task' } }
          }
          return { ok: true, status: 200, body: { status: 'succeeded', content: { video_url: 'https://cdn/i2v.mp4' } } }
        },
      },
      { match: '/contents/generations/tasks/i2v-task', respond: () => ({ ok: true, status: 200, body: { status: 'succeeded', content: { video_url: 'https://cdn/i2v.mp4' } } }) },
      { match: 'https://cdn/i2v.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])

    await router.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        outputDir: tmpDir,
        prompt: '让画面动起来',
        // 无显式 role 的图，i2v 模式下首张应作 first_frame
        inputFiles: [{ type: 'image', url: 'https://cdn/first.png' }],
      },
      {
        providers: [
          makeProvider({
            id: 'volc-prov',
            name: '火山 Seedance',
            defaultModel: 'doubao-seedance-2-0-260128',
            apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
            mediaProvider: 'volcengine-ark',
            mediaCapabilities: ['video.image_to_video'],
            mediaModelManifests: [seedanceManifest],
          }),
        ],
        fetch: fetchMock,
      },
    )

    const content = postedBody.content as Array<Record<string, unknown>>
    const firstFrame = content.find((item) => item.role === 'first_frame')
    expect(firstFrame).toBeDefined()
    expect((firstFrame!.image_url as { url: string }).url).toBe('https://cdn/first.png')
  })

  it('Seedance image_to_video with two role-less images infers first_frame + last_frame', async () => {
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const seedanceManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'volcengine:doubao-seedance-2-0-260128')!
    let postedBody: Record<string, unknown> = {}
    const fetchMock = makeFetch([
      {
        match: '/contents/generations/tasks',
        respond: (init) => {
          if (init?.method === 'POST') {
            postedBody = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
            return { ok: true, status: 200, body: { id: 'i2v-tail' } }
          }
          return { ok: true, status: 200, body: { status: 'succeeded', content: { video_url: 'https://cdn/i2v2.mp4' } } }
        },
      },
      { match: '/contents/generations/tasks/i2v-tail', respond: () => ({ ok: true, status: 200, body: { status: 'succeeded', content: { video_url: 'https://cdn/i2v2.mp4' } } }) },
      { match: 'https://cdn/i2v2.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])

    await router.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        outputDir: tmpDir,
        prompt: '首尾帧过渡',
        // 两张无 role 图：i2v 兜底应分别作 first_frame / last_frame
        inputFiles: [
          { type: 'image', url: 'https://cdn/start.png' },
          { type: 'image', url: 'https://cdn/end.png' },
        ],
      },
      {
        providers: [
          makeProvider({
            id: 'volc-prov',
            name: '火山 Seedance',
            defaultModel: 'doubao-seedance-2-0-260128',
            apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
            mediaProvider: 'volcengine-ark',
            mediaCapabilities: ['video.image_to_video'],
            mediaModelManifests: [seedanceManifest],
          }),
        ],
        fetch: fetchMock,
      },
    )

    const content = postedBody.content as Array<Record<string, unknown>>
    const firstFrame = content.find((item) => item.role === 'first_frame')
    const lastFrame = content.find((item) => item.role === 'last_frame')
    expect(firstFrame).toBeDefined()
    expect(lastFrame).toBeDefined()
    expect((firstFrame!.image_url as { url: string }).url).toBe('https://cdn/start.png')
    expect((lastFrame!.image_url as { url: string }).url).toBe('https://cdn/end.png')
    // 这两张不应再重复作为 reference_image
    const refs = content.filter((item) => item.role === 'reference_image')
    expect(refs).toHaveLength(0)
  })

  it('Seedream image.edit (multi-image fusion): passes image[] array and honors searchEnabled alias', async () => {
    const seedreamManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'volcengine:doubao-seedream-4-5-251128')!
    let postedBody: Record<string, unknown> = {}
    const fetchMock = makeFetch([
      {
        match: '/images/generations',
        respond: (init) => {
          postedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: { data: [{ url: 'https://cdn/fusion.png' }] } }
        },
      },
      { match: 'https://cdn/fusion.png', respond: () => ({ ok: true, status: 200, body: null, binary: Buffer.from(PNG_PIXEL, 'base64') }) },
    ])

    await router.invoke(
      {
        operation: 'image_to_image',
        capability: 'image.edit',
        outputDir: tmpDir,
        prompt: '把图1的衣服换成图2的衣服',
        inputFiles: [
          { type: 'image', url: 'https://cdn/model.png' },
          { type: 'image', url: 'https://cdn/outfit.png' },
        ],
        // 用 manifest alias enable_search 写法，验证 buildSeedreamParams 多别名兼容
        modelParams: { enable_search: true },
      },
      {
        providers: [
          makeProvider({
            id: 'volc-img',
            name: '火山 Seedream',
            defaultModel: 'doubao-seedream-4-5-251128',
            apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
            mediaProvider: 'volcengine-ark',
            mediaApiType: 'sync',
            mediaCapabilities: ['image.generate', 'image.edit'],
            mediaModelManifests: [seedreamManifest],
          }),
        ],
        fetch: fetchMock,
      },
    )

    // 多图融合：image 字段为 string[]
    expect(Array.isArray(postedBody.image)).toBe(true)
    expect(postedBody.image).toEqual(['https://cdn/model.png', 'https://cdn/outfit.png'])
    // enable_search 别名命中 → tools 含 web_search
    expect(postedBody.tools).toEqual([{ type: 'web_search' }])
  })

  it('Seedream image.generate (sync): posts OpenAI-compatible /images/generations and writes image', async () => {
    const seedreamManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'volcengine:doubao-seedream-4-5-251128')!
    let postedBody: Record<string, unknown> = {}
    const fetchMock = makeFetch([
      {
        match: '/images/generations',
        respond: (init) => {
          postedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: { data: [{ url: 'https://cdn/seedream.png' }] } }
        },
      },
      { match: 'https://cdn/seedream.png', respond: () => ({ ok: true, status: 200, body: null, binary: Buffer.from(PNG_PIXEL, 'base64') }) },
    ])

    const { output } = await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        outputDir: tmpDir,
        prompt: '一只赛博朋克风格的猫',
        // Seedream 4.5 仅支持 jpeg 输出，schema 已限定 enum=['jpeg']
        modelParams: { size: '4K', outputFormat: 'jpeg', watermark: false },
      },
      {
        providers: [
          makeProvider({
            id: 'volc-img',
            name: '火山 Seedream',
            defaultModel: 'doubao-seedream-4-5-251128',
            apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
            mediaProvider: 'volcengine-ark',
            mediaApiType: 'sync',
            mediaCapabilities: ['image.generate', 'image.edit'],
            mediaModelManifests: [seedreamManifest],
          }),
        ],
        fetch: fetchMock,
      },
    )

    expect(postedBody.model).toBe('doubao-seedream-4-5-251128')
    expect(postedBody.prompt).toBe('一只赛博朋克风格的猫')
    expect(postedBody.size).toBe('4K')
    expect(postedBody.output_format).toBe('jpeg')
    expect(postedBody.watermark).toBe(false)
    expect(output.mode).toBe('sync')
    expect(output.assets[0]?.type).toBe('image')
    expect(existsSync(output.assets[0]!.filePath!)).toBe(true)
  })

  it('Seedance video.generate forwards searchEnabled as tools=[{web_search}] (Seedance 2.0 联网搜索)', async () => {
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const seedanceManifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'volcengine:doubao-seedance-2-0-260128')!
    let postedBody: Record<string, unknown> = {}
    const fetchMock = makeFetch([
      {
        match: '/contents/generations/tasks',
        respond: (init) => {
          if (init?.method === 'POST') {
            postedBody = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>
            return { ok: true, status: 200, body: { id: 'seedance-search-task' } }
          }
          return { ok: true, status: 200, body: { status: 'succeeded', content: { video_url: 'https://cdn/search.mp4' } } }
        },
      },
      {
        match: '/contents/generations/tasks/seedance-search-task',
        respond: () => ({ ok: true, status: 200, body: { status: 'succeeded', content: { video_url: 'https://cdn/search.mp4' } } }),
      },
      { match: 'https://cdn/search.mp4', respond: () => ({ ok: true, status: 200, body: null, binary: videoBuf }) },
    ])

    await router.invoke(
      {
        operation: 'text_to_video',
        capability: 'video.generate',
        outputDir: tmpDir,
        prompt: '上海未来 5 日天气',
        // 纯文本输入，开启联网搜索
        modelParams: { searchEnabled: true, durationSeconds: 5, aspectRatio: '16:9' },
      },
      {
        providers: [
          makeProvider({
            id: 'volc-search',
            name: '火山 Seedance 联网',
            defaultModel: 'doubao-seedance-2-0-260128',
            apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
            mediaProvider: 'volcengine-ark',
            mediaApiType: 'async',
            mediaCapabilities: ['video.generate'],
            mediaModelManifests: [seedanceManifest],
            mediaDefaults: { polling: { intervalMs: 1, timeoutMs: 5_000 } },
          }),
        ],
        fetch: fetchMock,
      },
    )

    // 关键：searchEnabled 必须落到 tools=[{type:'web_search'}]，否则联网搜索完全失效
    expect(postedBody.tools).toEqual([{ type: 'web_search' }])
    expect(postedBody.ratio).toBe('16:9')
  })

  it('Seedream 4.0 text-to-image: passes prompt_optimization_mode and jpeg-only output', async () => {
    const seedream40Manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'volcengine:doubao-seedream-4-0-250828')!
    let postedBody: Record<string, unknown> = {}
    const fetchMock = makeFetch([
      {
        match: '/images/generations',
        respond: (init) => {
          postedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: { data: [{ url: 'https://cdn/seedream40.jpg' }] } }
        },
      },
      { match: 'https://cdn/seedream40.jpg', respond: () => ({ ok: true, status: 200, body: null, binary: Buffer.from(PNG_PIXEL, 'base64') }) },
    ])

    await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        outputDir: tmpDir,
        prompt: '一只猫',
        modelParams: { size: '4K', outputFormat: 'jpeg', promptOptimizationMode: 'fast', watermark: false },
      },
      {
        providers: [
          makeProvider({
            id: 'volc-seedream40',
            name: '火山 Seedream 4.0',
            defaultModel: 'doubao-seedream-4-0-250828',
            apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
            mediaProvider: 'volcengine-ark',
            mediaApiType: 'sync',
            mediaCapabilities: ['image.generate', 'image.edit'],
            mediaModelManifests: [seedream40Manifest],
          }),
        ],
        fetch: fetchMock,
      },
    )

    expect(postedBody.model).toBe('doubao-seedream-4-0-250828')
    expect(postedBody.size).toBe('4K')
    expect(postedBody.output_format).toBe('jpeg')
    expect(postedBody.prompt_optimization_mode).toBe('fast')
  })

  it('HappyHorse 1.0 i2v manifest exists with media[] structure', () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'bailian:happyhorse-1.0-i2v')
    expect(manifest).toBeDefined()
    expect(manifest!.modelId).toBe('happyhorse-1.0-i2v')
    expect(manifest!.capabilities[0]?.id).toBe('video.image_to_video')
    // 输入只接 1 张首帧图，与 1.1-i2v 一致
    expect(manifest!.capabilities[0]?.input.maxImages).toBe(1)
  })

  it('HappyHorse 1.0 t2v model id is lowercased', () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'bailian:happyhorse-1.0-t2v')
    expect(manifest).toBeDefined()
    expect(manifest!.modelId).toBe('happyhorse-1.0-t2v')
    // 旧的大写 manifest id 必须移除
    const legacy = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === 'bailian:HappyHorse-1.0-T2V')
    expect(legacy).toBeUndefined()
  })

  it('Seedance 1.x manifests are registered with duration [2,12]', () => {
    const ids = [
      'volcengine:doubao-seedance-1-5-pro-251215',
      'volcengine:doubao-seedance-1-0-pro-250528',
      'volcengine:doubao-seedance-1-0-pro-fast-251015',
    ]
    for (const id of ids) {
      const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === id)
      expect(manifest, `${id} missing`).toBeDefined()
      const schema = manifest!.capabilities[0]?.paramSchema as { properties?: Record<string, { minimum?: number; maximum?: number }> }
      expect(schema.properties?.durationSeconds?.minimum).toBe(2)
      expect(schema.properties?.durationSeconds?.maximum).toBe(12)
    }
  })
})
