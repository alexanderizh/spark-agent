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

  it('xAI does not support audio.transcription', () => {
    const xai = new XaiMediaAdapter()
    expect(xai.supports('audio.transcription')).toBe(false)
    expect(xai.supports('audio.speech')).toBe(true)
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
          defaults: { n: 1 },
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
})
