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
import { capabilityForOperation, type MediaModelManifest } from '@spark/protocol'

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

  it('xAI grok-imagine-video video_edit sends first frame, last frame, input video, and edit strength', async () => {
    const captured: { body: Record<string, unknown> } = { body: {} }
    const videoBuf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70])
    const fetchMock = makeFetch([
      { match: '/videos/xai-edit-1', respond: () =>
        ({ ok: true, status: 200, body: { status: 'completed', video_url: 'https://cdn/xai-edited.mp4' } }) },
      { match: '/videos/generations', respond: (init) => {
        captured.body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
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
          { type: 'image', role: 'first_frame', dataUrl: `data:image/png;base64,${PNG_PIXEL}` },
          { type: 'image', role: 'last_frame', url: 'https://cdn/last.png' },
          { type: 'image', role: 'reference', url: 'https://cdn/ref.png' },
        ],
        modelParams: { editStrength: 0.6 },
      },
      {
        providers: [makeProvider({
          id: 'xai-video',
          name: 'xAI Imagine Video',
          apiEndpoint: XAI_ENDPOINT,
          mediaProvider: 'xai',
          mediaApiType: 'async',
          defaultModel: 'grok-imagine-video',
          mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit'],
          mediaDefaults: {
            polling: { intervalMs: 1, timeoutMs: 5_000 },
          },
        })],
        fetch: fetchMock,
      },
    )

    expect(captured.body).toMatchObject({
      model: 'grok-imagine-video',
      prompt: 'make the motion smoother',
      image: { url: `data:image/png;base64,${PNG_PIXEL}` },
      last_frame_image: 'https://cdn/last.png',
      video: 'https://cdn/source.mp4',
      video_url: 'https://cdn/source.mp4',
      edit_strength: 0.6,
    })
    expect(captured.body.reference_images).toEqual([{ url: 'https://cdn/ref.png' }])
    expect(output.provider).toBe('xai')
    expect(output.mode).toBe('async')
    expect(output.requestId).toBe('xai-edit-1')
    expect(readFileSync(output.assets[0]!.filePath!)).toEqual(videoBuf)
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
