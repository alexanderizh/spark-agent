import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { TencentTokenhubMediaAdapter } from '../../../services/media/adapters/tencent-tokenhub-media.adapter.js'
import { MediaRouterService } from '../../../services/media/media-router.service.js'
import { buildTencentVideoRequest } from '../../../services/media/tencent-tokenhub-media-request.js'
import { validateMediaRequest } from '../../../services/media/media-request-validator.js'
import type {
  MediaGenerateInput,
  MediaProviderContext,
} from '../../../services/media/media-adapter.types.js'
import { MediaProviderError } from '../../../services/media/media-adapter.types.js'
import { BUILTIN_MEDIA_MODEL_MANIFESTS, type MediaModelManifest } from '@spark/protocol'

const ENDPOINT = 'https://tokenhub.tencentmaas.com'

type FetchHandler = (url: string, init?: RequestInit) => Promise<Response>
type FetchMock = typeof globalThis.fetch & {
  mock: { calls: Array<[string, RequestInit | undefined]> }
}

/** vi.fn 的 mock.calls tuple 类型对可选 init 参数推断不友好，统一 cast 成 [url, init]。 */
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

const FAKE_MP4 = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
])
const FAKE_PNG = Buffer.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ),
)

function makeContext(overrides: Partial<MediaProviderContext>): MediaProviderContext {
  return {
    apiKey: 'sk-test',
    apiEndpoint: ENDPOINT,
    defaultModel: 'hy-video-1.5',
    mediaProvider: 'tencent-tokenhub',
    mediaApiType: 'async',
    ...overrides,
  }
}

function makeInput(overrides: Partial<MediaGenerateInput>): MediaGenerateInput {
  return {
    operation: 'text_to_video',
    capability: 'video.generate',
    prompt: '小河流水',
    outputDir: '',
    ...overrides,
  }
}

function manifestContext(
  id: string,
  capabilityId: 'video.generate' | 'video.image_to_video',
  overrides: Partial<MediaProviderContext> = {},
): MediaProviderContext {
  const manifest = findManifest(id)
  const capability = manifest.capabilities.find((item) => item.id === capabilityId)
  if (!capability) throw new Error(`${id} capability ${capabilityId} not found`)
  return makeContext({
    defaultModel: manifest.modelId,
    mediaManifest: manifest,
    mediaManifestCapability: capability,
    ...overrides,
  })
}

describe('TencentTokenhubMediaAdapter', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `tencent-tokenhub-test-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('模型配置单完整包含 2 图片 + 4 原生视频 + 9 Kling + 6 Vidu', () => {
    const manifests = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (manifest) => manifest.providerKind === 'tencent-tokenhub',
    )
    expect(manifests).toHaveLength(21)
    expect(
      manifests
        .filter((manifest) => manifest.modelId.startsWith('kl-video-'))
        .map((m) => m.modelId),
    ).toEqual([
      'kl-video-v3',
      'kl-video-v2-6',
      'kl-video-v2-5-turbo',
      'kl-video-v2-1-master',
      'kl-video-v2-1',
      'kl-video-v2-master',
      'kl-video-v1-6',
      'kl-video-v1-5',
      'kl-video-v1',
    ])
    const fx = findManifest('tencent-tokenhub:yt-video-fx').capabilities[0]
    const template = (fx?.paramSchema.properties as Record<string, { enum?: unknown[] }>).template
    expect(new Set(template?.enum).size).toBe(141)
    const klingImageCapability = findManifest('tencent-tokenhub:kl-video-v3').capabilities.find(
      (capability) => capability.id === 'video.image_to_video',
    )
    expect(klingImageCapability?.input.acceptedMimeTypes).toEqual(['image/jpeg', 'image/png'])
    expect(new MediaRouterService().listAdapters()).toContain('tencent-tokenhub')
  })

  it('video.generate: POST submit → POST query 轮询，query body 为 {model, id}，取 data:{url} 对象', async () => {
    const manifest = findManifest('tencent-tokenhub:hy-video-1.5')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')
    if (!cap) throw new Error('capability not found')
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/api/video/submit')) {
        return jsonRes({ id: 'job-123', request_id: 'req-1', object: 'video', status: 'queued' })
      }
      if (url.endsWith('/v1/api/video/query')) {
        return jsonRes({ status: 'completed', progress: 100, data: { url: 'https://tc/r.mp4' } })
      }
      if (url === 'https://tc/r.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    const onTaskSubmitted = vi.fn()
    const adapter = new TencentTokenhubMediaAdapter()
    const out = await adapter.invoke(
      makeInput({ outputDir: tmpDir }),
      makeContext({
        defaultModel: 'hy-video-1.5',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        onTaskSubmitted,
      }),
    )

    // 任务 id 用响应的 id 字段（不是 request_id），立即上报
    expect(onTaskSubmitted).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'job-123' }))
    // query 是 POST，body 为 {model, id}
    const queryCall = fetchImpl.mock.calls.find(([u]) => u.endsWith('/v1/api/video/query'))
    expect(queryCall).toBeTruthy()
    const queryInit = queryCall?.[1]
    expect(queryInit?.method).toBe('POST')
    expect(JSON.parse(queryInit?.body as string)).toEqual({ model: 'hy-video-1.5', id: 'job-123' })
    // 视频 data:{url} 对象被提取并下载落盘
    expect(out.mode).toBe('async')
    expect(out.assets).toHaveLength(1)
    const asset = out.assets[0]
    expect(asset).toBeTruthy()
    expect(existsSync(asset?.filePath ?? '')).toBe(true)
    expect(readFileSync(asset?.filePath ?? '').byteLength).toBe(FAKE_MP4.byteLength)
  })

  it('image.generate 同步: POST /v1/api/image/lite，取 data:[{url}] 数组', async () => {
    const manifest = findManifest('tencent-tokenhub:hy-image-lite')
    const cap = manifest.capabilities.find((c) => c.id === 'image.generate')
    if (!cap) throw new Error('capability not found')
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/api/image/lite')) {
        return jsonRes({ created: 1, request_id: 'r', data: [{ url: 'https://tc/img.png' }] })
      }
      if (url === 'https://tc/img.png') return binaryRes(FAKE_PNG)
      throw new Error(`unexpected fetch ${url}`)
    })
    const adapter = new TencentTokenhubMediaAdapter()
    const out = await adapter.invoke(
      makeInput({
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: '雨中竹林',
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: 'hy-image-lite',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
    )

    const liteCall = fetchImpl.mock.calls.find(([u]) => u.endsWith('/v1/api/image/lite'))
    const liteInit = liteCall?.[1]
    expect(liteInit?.method).toBe('POST')
    expect(JSON.parse(liteInit?.body as string).rsp_img_type).toBe('url')
    expect(out.mode).toBe('sync')
    expect(out.assets).toHaveLength(1)
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
  })

  it('错误归一: 401 + error.code 401002 → normalized.code = auth_failed', async () => {
    const manifest = findManifest('tencent-tokenhub:hy-image-lite')
    const cap = manifest.capabilities.find((c) => c.id === 'image.generate')
    if (!cap) throw new Error('capability not found')
    const fetchImpl = mockFetch(async () =>
      jsonRes(
        {
          error: {
            code: '401002',
            message: 'The API Key does not exist',
            message_zh: 'API Key 不存在或签名校验失败',
            type: 'gateway_error',
            request_id: 'req-auth-1',
          },
        },
        401,
      ),
    )
    const adapter = new TencentTokenhubMediaAdapter()
    await expect(
      adapter.invoke(
        makeInput({
          operation: 'text_to_image',
          capability: 'image.generate',
          outputDir: tmpDir,
        }),
        makeContext({
          defaultModel: 'hy-image-lite',
          fetch: fetchImpl,
          mediaManifest: manifest,
          mediaManifestCapability: cap,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'MediaProviderError',
      statusCode: 401,
      normalized: { code: 'auth_failed', providerCode: '401002', requestId: 'req-auth-1' },
    })
  })

  it('task failed: query 返回 status=failed → task_failed (MediaProviderError)', async () => {
    const manifest = findManifest('tencent-tokenhub:hy-video-1.5')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')
    if (!cap) throw new Error('capability not found')
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/api/video/submit')) return jsonRes({ id: 'job-f' })
      if (url.endsWith('/v1/api/video/query')) return jsonRes({ status: 'failed', data: {} })
      throw new Error(`unexpected fetch ${url}`)
    })
    const adapter = new TencentTokenhubMediaAdapter()
    await expect(
      adapter.invoke(
        makeInput({ outputDir: tmpDir }),
        makeContext({
          defaultModel: 'hy-video-1.5',
          fetch: fetchImpl,
          mediaManifest: manifest,
          mediaManifestCapability: cap,
          mediaDefaults: { polling: { intervalMs: 1, timeoutMs: 1000 } },
        }),
      ),
    ).rejects.toBeInstanceOf(MediaProviderError)
  })

  it('Kling v3 完整录入 3–15 秒，并按 TokenHub 协议编译复杂参数', async () => {
    const ctx = manifestContext('tencent-tokenhub:kl-video-v3', 'video.generate')
    const properties = ctx.mediaManifestCapability?.paramSchema.properties as Record<
      string,
      { enum?: unknown[] }
    >
    expect(properties.durationSeconds?.enum).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    expect(properties.cfgScale).toBeDefined()
    expect(properties.sound).toBeDefined()

    const body = await buildTencentVideoRequest(
      makeInput({
        modelParams: {
          durationSeconds: 14,
          cfgScale: 0.7,
          multiShot: true,
          shotType: 'customize',
          multiPrompt: [
            { index: 1, prompt: '开场', duration: 7 },
            { index: 2, prompt: '结尾', duration: 7 },
          ],
          cameraControl: { type: 'simple', config: { horizontal: 1 } },
        },
      }),
      ctx,
    )
    expect(body).toMatchObject({
      model: 'kl-video-v3',
      duration: '14',
      cfg_scale: 0.7,
      multi_shot: true,
      shot_type: 'customize',
      multi_prompt: [
        { index: 1, prompt: '开场', duration: 7 },
        { index: 2, prompt: '结尾', duration: 7 },
      ],
      camera_control: { type: 'simple', config: { horizontal: 1 } },
    })
    expect(body).not.toHaveProperty('prompt')
  })

  it('Kling v2.1 master 保留 cfg_scale，v2.6 严格裁掉不支持参数', async () => {
    const masterCtx = manifestContext('tencent-tokenhub:kl-video-v2-1-master', 'video.generate')
    const masterBody = await buildTencentVideoRequest(
      makeInput({ modelParams: { cfgScale: 0.25 } }),
      masterCtx,
    )
    expect(masterBody.cfg_scale).toBe(0.25)

    const v26Ctx = manifestContext('tencent-tokenhub:kl-video-v2-6', 'video.generate')
    const v26Body = await buildTencentVideoRequest(
      makeInput({ modelParams: { cfgScale: 0.25 } }),
      v26Ctx,
    )
    expect(v26Body).not.toHaveProperty('cfg_scale')

    const imageCtx = manifestContext('tencent-tokenhub:kl-video-v2-1', 'video.image_to_video')
    const imageProperties = imageCtx.mediaManifestCapability?.paramSchema.properties as Record<
      string,
      unknown
    >
    expect(imageProperties.aspectRatio).toBeUndefined()
  })

  it('YT-Video-FX 使用 images[]，模板不再强制 prompt', async () => {
    const body = await buildTencentVideoRequest(
      makeInput({
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: '',
        inputFiles: [
          { type: 'image', url: 'https://tc/a.png', role: 'reference' },
          { type: 'image', url: 'https://tc/b.png', role: 'reference' },
        ],
        modelParams: { template: 'hug', resolution: '720p', bgm: true },
      }),
      manifestContext('tencent-tokenhub:yt-video-fx', 'video.image_to_video'),
    )
    expect(body).toMatchObject({
      model: 'yt-video-fx',
      template: 'hug',
      resolution: '720p',
      bgm: true,
      images: [{ url: 'https://tc/a.png' }, { url: 'https://tc/b.png' }],
    })
    expect(body).not.toHaveProperty('prompt')

    await expect(
      buildTencentVideoRequest(
        makeInput({
          operation: 'image_to_video',
          capability: 'video.image_to_video',
          inputFiles: [{ type: 'image', url: 'https://tc/a.png' }],
          modelParams: { template: 'onestory' },
        }),
        manifestContext('tencent-tokenhub:yt-video-fx', 'video.image_to_video'),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('YT-Video-HumanActor 组装 prompt + audio_url + image_url', async () => {
    const body = await buildTencentVideoRequest(
      makeInput({
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: '人物自然讲解',
        inputFiles: [
          { type: 'image', url: 'https://tc/person.png', role: 'first_frame' },
          { type: 'audio', url: 'https://tc/voice.mp3', role: 'reference' },
        ],
      }),
      manifestContext('tencent-tokenhub:yt-video-humanactor', 'video.image_to_video'),
    )
    expect(body).toMatchObject({
      model: 'yt-video-humanactor',
      prompt: '人物自然讲解',
      image_url: 'https://tc/person.png',
      audio_url: 'https://tc/voice.mp3',
      resolution: '1080p',
      frame_rate: 50,
    })
  })

  it('Vidu 图生视频使用有序 images[]，并录入回调/透传/错峰参数', async () => {
    const ctx = manifestContext('tencent-tokenhub:vd-video-q3-pro', 'video.image_to_video')
    const body = await buildTencentVideoRequest(
      makeInput({
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        inputFiles: [
          { type: 'image', url: 'https://tc/tail.png', role: 'last_frame' },
          { type: 'image', url: 'https://tc/first.png', role: 'first_frame' },
        ],
        modelParams: {
          durationSeconds: 16,
          metaData: '{"scene":"demo"}',
          payload: 'trace-1',
          offPeak: true,
        },
      }),
      ctx,
    )
    expect(body).toMatchObject({
      model: 'vd-video-q3-pro',
      images: ['https://tc/first.png', 'https://tc/tail.png'],
      duration: 16,
      meta_data: '{"scene":"demo"}',
      payload: 'trace-1',
      off_peak: true,
    })
    const properties = ctx.mediaManifestCapability?.paramSchema.properties as Record<
      string,
      unknown
    >
    expect(properties.style).toBeUndefined()
    expect(properties.movementAmplitude).toBeUndefined()
  })

  it('腾讯 validator 阻断 Kling 错误分镜、非法首尾帧组合和 Vidu Q2 超长首尾帧', () => {
    const klingCtx = manifestContext('tencent-tokenhub:kl-video-v3', 'video.generate')
    const klingResult = validateMediaRequest({
      input: makeInput({
        modelParams: {
          durationSeconds: 10,
          multiShot: true,
          shotType: 'customize',
          multiPrompt: [{ index: 1, prompt: '只有一段', duration: 5 }],
        },
      }),
      providerKind: 'tencent-tokenhub',
      modelId: klingCtx.defaultModel,
      capability: 'video.generate',
      manifest: klingCtx.mediaManifest,
      manifestCapability: klingCtx.mediaManifestCapability,
      mode: 'adapter',
    })
    expect(klingResult.blockingIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'conflicting_params' })]),
    )

    const validMultiShot = validateMediaRequest({
      input: makeInput({
        prompt: '',
        modelParams: {
          durationSeconds: 10,
          multiShot: true,
          shotType: 'customize',
          multiPrompt: [{ index: 1, prompt: '完整分镜', duration: 10 }],
        },
      }),
      providerKind: 'tencent-tokenhub',
      modelId: klingCtx.defaultModel,
      capability: 'video.generate',
      manifest: klingCtx.mediaManifest,
      manifestCapability: klingCtx.mediaManifestCapability,
      mode: 'adapter',
    })
    expect(validMultiShot.blockingIssues).toEqual([])

    const missingPrompt = validateMediaRequest({
      input: makeInput({ prompt: '', modelParams: { multiShot: false } }),
      providerKind: 'tencent-tokenhub',
      modelId: klingCtx.defaultModel,
      capability: 'video.generate',
      manifest: klingCtx.mediaManifest,
      manifestCapability: klingCtx.mediaManifestCapability,
      mode: 'adapter',
    })
    expect(missingPrompt.blockingIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'missing_required' })]),
    )

    const v21Ctx = manifestContext('tencent-tokenhub:kl-video-v2-1', 'video.image_to_video')
    const v21TailInStd = validateMediaRequest({
      input: makeInput({
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        inputFiles: [
          { type: 'image', url: 'https://tc/first.png', role: 'first_frame' },
          { type: 'image', url: 'https://tc/tail.png', role: 'last_frame' },
        ],
        modelParams: { mode: 'std' },
      }),
      providerKind: 'tencent-tokenhub',
      modelId: v21Ctx.defaultModel,
      capability: 'video.image_to_video',
      manifest: v21Ctx.mediaManifest,
      manifestCapability: v21Ctx.mediaManifestCapability,
      mode: 'adapter',
    })
    expect(v21TailInStd.blockingIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'conflicting_params' })]),
    )

    const v26Ctx = manifestContext('tencent-tokenhub:kl-video-v2-6', 'video.image_to_video')
    const v26TailWithSound = validateMediaRequest({
      input: makeInput({
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        inputFiles: [
          { type: 'image', url: 'https://tc/first.png', role: 'first_frame' },
          { type: 'image', url: 'https://tc/tail.png', role: 'last_frame' },
        ],
        modelParams: { sound: 'on' },
      }),
      providerKind: 'tencent-tokenhub',
      modelId: v26Ctx.defaultModel,
      capability: 'video.image_to_video',
      manifest: v26Ctx.mediaManifest,
      manifestCapability: v26Ctx.mediaManifestCapability,
      mode: 'adapter',
    })
    expect(v26TailWithSound.blockingIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'conflicting_params' })]),
    )

    const viduCtx = manifestContext('tencent-tokenhub:vd-video-q2-pro', 'video.image_to_video')
    const viduResult = validateMediaRequest({
      input: makeInput({
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        inputFiles: [
          { type: 'image', url: 'https://tc/first.png', role: 'first_frame' },
          { type: 'image', url: 'https://tc/tail.png', role: 'last_frame' },
        ],
        modelParams: { durationSeconds: 10 },
      }),
      providerKind: 'tencent-tokenhub',
      modelId: viduCtx.defaultModel,
      capability: 'video.image_to_video',
      manifest: viduCtx.mediaManifest,
      manifestCapability: viduCtx.mediaManifestCapability,
      mode: 'adapter',
    })
    expect(viduResult.blockingIssues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'conflicting_params' })]),
    )
  })
})
