import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MinimaxHailuoMediaAdapter } from '../../../services/media/adapters/minimax-hailuo-media.adapter.js'
import { MediaRouterService } from '../../../services/media/media-router.service.js'
import { validateMediaRequest } from '../../../services/media/media-request-validator.js'
import type {
  MediaGenerateInput,
  MediaInputFile,
  MediaProviderContext,
} from '../../../services/media/media-adapter.types.js'
import { MediaProviderError } from '../../../services/media/media-adapter.types.js'
import {
  BUILTIN_MEDIA_MODEL_MANIFESTS,
  type MediaCapabilityId,
  type MediaModelManifest,
} from '@spark/protocol'

const ENDPOINT = 'https://api.minimaxi.com'

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

function rawJsonRes(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
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
// ID3v2 头（音频测试用，非合法完整 mp3，仅用于落盘 buffer 比对）
const FAKE_MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x10, 0x00, 0x00, 0x00, 0x20, 0x53])
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
    defaultModel: 'image-01',
    mediaProvider: 'minimax-hailuo',
    mediaApiType: 'sync',
    ...overrides,
  }
}

function makeInput(overrides: Partial<MediaGenerateInput>): MediaGenerateInput {
  return {
    operation: 'text_to_image',
    capability: 'image.generate',
    prompt: '雨中竹林',
    outputDir: '',
    ...overrides,
  }
}

function manifestContext(
  id: string,
  capabilityId: string,
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

describe('MinimaxHailuoMediaAdapter', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `minimax-test-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('本轮开发的 6 个 manifest 已注册且 router 已挂 minimax-hailuo adapter', () => {
    const ids = BUILTIN_MEDIA_MODEL_MANIFESTS.filter(
      (m) => m.providerKind === 'minimax-hailuo',
    ).map((m) => m.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'minimax:image-01',
        'minimax:image-01-live',
        'minimax:hailuo-2.3',
        'minimax:hailuo-2.3-fast',
        'minimax:v2-h3',
        'minimax:hailuo-template',
      ]),
    )
    // video.edit 已从 hailuo-2.3 移除（文档无独立 edit 端点）
    const hailuo23 = findManifest('minimax:hailuo-2.3')
    expect(hailuo23.capabilities.map((c) => c.id)).toEqual([
      'video.generate',
      'video.image_to_video',
    ])
    // image.edit 已加入 image-01
    expect(findManifest('minimax:image-01').capabilities.map((c) => c.id)).toEqual([
      'image.generate',
      'image.edit',
    ])
    expect(new MediaRouterService().listAdapters()).toContain('minimax-hailuo')
  })

  it('image.generate 同步: POST /v1/image_generation，取 data.image_urls[] 落盘', async () => {
    const manifest = findManifest('minimax:image-01')
    const cap = manifest.capabilities.find((c) => c.id === 'image.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/image_generation')) {
        return jsonRes({
          id: 'img-1',
          data: { image_urls: ['https://cdn/img.png'] },
          metadata: { success_count: 1, failed_count: '0' },
          base_resp: { status_code: 0, status_msg: 'success' },
        })
      }
      if (url === 'https://cdn/img.png') return binaryRes(FAKE_PNG)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({ outputDir: tmpDir }),
      makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
    )
    expect(out.mode).toBe('sync')
    expect(out.assets).toHaveLength(1)
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
    const post = fetchImpl.mock.calls.find(([u]) => u.endsWith('/v1/image_generation'))?.[1]
    expect(JSON.parse(post?.body as string)).toMatchObject({
      model: 'image-01',
      prompt: '雨中竹林',
    })
  })

  it('image-01 支持 8 的倍数自定义宽高，并在请求前拒绝非法尺寸', async () => {
    const manifest = findManifest('minimax:image-01')
    const cap = manifest.capabilities.find((c) => c.id === 'image.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/image_generation')) {
        return jsonRes({
          data: { image_urls: ['https://cdn/custom.png'] },
          base_resp: { status_code: 0 },
        })
      }
      if (url === 'https://cdn/custom.png') return binaryRes(FAKE_PNG)
      throw new Error(`unexpected fetch ${url}`)
    })

    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({ outputDir: tmpDir, modelParams: { width: 1536, height: 1024 } }),
      makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
    )
    const body = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u.endsWith('/v1/image_generation'))?.[1]?.body as string,
    )
    expect(body).toMatchObject({ width: 1536, height: 1024 })

    await expect(
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({ outputDir: tmpDir, modelParams: { width: 1537, height: 1024 } }),
        makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
      ),
    ).rejects.toThrow('8 的倍数')
  })

  it('image-01-live 不接受 image-01 专属的 21:9 与自定义宽高', async () => {
    const manifest = findManifest('minimax:image-01-live')
    const cap = manifest.capabilities.find((c) => c.id === 'image.generate')!
    const fetchImpl = mockFetch(async () => {
      throw new Error('provider must not be called')
    })
    const invoke = (modelParams: Record<string, unknown>) =>
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({ outputDir: tmpDir, modelParams }),
        makeContext({
          defaultModel: 'image-01-live',
          fetch: fetchImpl,
          mediaManifest: manifest,
          mediaManifestCapability: cap,
        }),
      )
    await expect(invoke({ aspectRatio: '21:9' })).rejects.toThrow('不支持画幅')
    await expect(invoke({ width: 1024, height: 1024 })).rejects.toThrow('仅 image-01 支持')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('image-01-live 把 style_type/style_weight 组装成嵌套 style，且仅该模型生效', async () => {
    const manifest = findManifest('minimax:image-01-live')
    const cap = manifest.capabilities.find((c) => c.id === 'image.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/image_generation')) {
        return jsonRes({
          data: { image_urls: ['https://cdn/live.png'] },
          base_resp: { status_code: 0 },
        })
      }
      if (url === 'https://cdn/live.png') return binaryRes(FAKE_PNG)
      throw new Error(`unexpected fetch ${url}`)
    })
    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        outputDir: tmpDir,
        modelParams: { styleType: '漫画', style_type: '漫画', style_weight: 0.6 },
      }),
      makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
    )
    const body = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u.endsWith('/v1/image_generation'))?.[1]?.body as string,
    )
    expect(body.style).toEqual({ style_type: '漫画', style_weight: 0.6 })
  })

  it('image.edit 图生图: 组装 subject_reference[image_file]（公网 URL 直传）', async () => {
    const manifest = findManifest('minimax:image-01')
    const cap = manifest.capabilities.find((c) => c.id === 'image.edit')!
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/image_generation')) {
        return jsonRes({
          data: { image_urls: ['https://cdn/o.png'] },
          base_resp: { status_code: 0 },
        })
      }
      if (url === 'https://cdn/o.png') return binaryRes(FAKE_PNG)
      throw new Error(`unexpected fetch ${url}`)
    })
    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'image_to_image',
        capability: 'image.edit',
        prompt: '同一个人在咖啡馆',
        inputFiles: [{ type: 'image', url: 'https://cdn/ref.jpg', role: 'reference' }],
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
    )
    const body = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u.endsWith('/v1/image_generation'))?.[1]?.body as string,
    )
    expect(body.subject_reference).toEqual([
      { type: 'character', image_file: 'https://cdn/ref.jpg' },
    ])
  })

  it('v1 视频 generate: create→poll(Success)→file_id→retrieve(download_url)→下载', async () => {
    const manifest = findManifest('minimax:hailuo-2.3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (
        url.endsWith('/v1/video_generation') &&
        !url.includes('query') &&
        !url.includes('template')
      ) {
        return jsonRes({ task_id: 't-1', base_resp: { status_code: 0, status_msg: 'success' } })
      }
      if (url.includes('/v1/query/video_generation')) {
        return jsonRes({
          task_id: 't-1',
          status: 'Success',
          file_id: '176844028768320',
          base_resp: { status_code: 0 },
        })
      }
      if (url.includes('/v1/files/retrieve')) {
        return jsonRes({
          file: { file_id: 176844028768320, download_url: 'https://cdn/v.mp4' },
          base_resp: { status_code: 0 },
        })
      }
      if (url === 'https://cdn/v.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    const onTaskSubmitted = vi.fn()
    const out = await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: '小河流水',
        modelParams: { durationSeconds: 6, resolution: '1080P' },
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: 'MiniMax-Hailuo-2.3',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
        onTaskSubmitted,
      }),
    )
    expect(onTaskSubmitted).toHaveBeenCalledWith(expect.objectContaining({ requestId: 't-1' }))
    expect(out.mode).toBe('async')
    expect(out.assets).toHaveLength(1)
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
    const createBody = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v1/video_generation`)?.[1]
        ?.body as string,
    )
    expect(createBody).toMatchObject({
      model: 'MiniMax-Hailuo-2.3',
      duration: 6,
      resolution: '1080P',
    })
  })

  it('v1 错误归一: HTTP 200 + base_resp.status_code=1026 → normalized.content_policy_blocked', async () => {
    const manifest = findManifest('minimax:image-01')
    const cap = manifest.capabilities.find((c) => c.id === 'image.generate')!
    const fetchImpl = mockFetch(async () =>
      jsonRes({
        base_resp: { status_code: 1026, status_msg: '图片描述涉及敏感内容' },
      }),
    )
    await expect(
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({ outputDir: tmpDir }),
        makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
      ),
    ).rejects.toMatchObject({
      name: 'MediaProviderError',
      normalized: { code: 'content_policy_blocked', providerCode: '1026' },
    })
  })

  it('V2 H3 generate(t2v): content[] 仅 text + resolution=2K + ratio 必填', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url === `${ENDPOINT}/v2/video_generation`) return jsonRes({ task_id: 'h3-1' })
      if (url.includes('/v2/query/video_generation/')) {
        return jsonRes({
          task: { id: 'h3-1', status: 'succeeded', content: { url: 'https://cdn/h3.mp4' } },
        })
      }
      if (url === 'https://cdn/h3.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: '男孩海边打篮球',
        modelParams: { duration: 5, ratio: '16:9' },
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: 'MiniMax-H3',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
      }),
    )
    expect(out.mode).toBe('async')
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
    const body = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v2/video_generation`)?.[1]
        ?.body as string,
    )
    expect(body).toMatchObject({
      model: 'MiniMax-H3',
      resolution: '2K',
      duration: 5,
      ratio: '16:9',
      content: [{ type: 'text', text: '男孩海边打篮球' }],
    })
  })

  it('V2 H3 generate(t2v): resolution=768P 透传到请求体', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url === `${ENDPOINT}/v2/video_generation`) return jsonRes({ task_id: 'h3-768' })
      if (url.includes('/v2/query/video_generation/')) {
        return jsonRes({
          task: { status: 'succeeded', content: { url: 'https://cdn/h3-768.mp4' } },
        })
      }
      if (url === 'https://cdn/h3-768.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: '夜景车流',
        modelParams: { duration: 8, resolution: '768P', ratio: '16:9' },
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: 'MiniMax-H3',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
      }),
    )
    const body = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v2/video_generation`)?.[1]
        ?.body as string,
    )
    expect(body.resolution).toBe('768P')
    expect(body.duration).toBe(8)
  })

  it('V2 H3 generate(t2v): resolution 非枚举值兜底为 2K（adapter 二次防御）', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url === `${ENDPOINT}/v2/video_generation`) return jsonRes({ task_id: 'h3-fb' })
      if (url.includes('/v2/query/video_generation/')) {
        return jsonRes({ task: { status: 'succeeded', content: { url: 'https://cdn/h3-fb.mp4' } } })
      }
      if (url === 'https://cdn/h3-fb.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: '非法分辨率兜底',
        modelParams: { ratio: '16:9', resolution: '4K' },
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: 'MiniMax-H3',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
      }),
    )
    const body = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v2/video_generation`)?.[1]
        ?.body as string,
    )
    // validator 会拦 '4K'，但 adapter 兜底保证即使绕过校验也只发合法枚举。
    expect(body.resolution).toBe('2K')
  })

  it('V2 H3: BaseURL 已带 /v2 时不会重复拼接版本路径', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url === `${ENDPOINT}/v2/video_generation`) return jsonRes({ task_id: 'h3-base-v2' })
      if (url === `${ENDPOINT}/v2/query/video_generation/h3-base-v2`) {
        return jsonRes({
          task: { status: 'succeeded', content: { url: 'https://cdn/h3-base-v2.mp4' } },
        })
      }
      if (url === 'https://cdn/h3-base-v2.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })

    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: '基础地址带版本后缀',
        modelParams: { duration: 5, ratio: '16:9' },
        outputDir: tmpDir,
      }),
      makeContext({
        apiEndpoint: `${ENDPOINT}/v2`,
        defaultModel: 'MiniMax-H3',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
      }),
    )

    expect(fetchImpl.mock.calls.some(([url]) => url === `${ENDPOINT}/v2/v2/video_generation`)).toBe(
      false,
    )
    expect(fetchImpl.mock.calls.some(([url]) => url === `${ENDPOINT}/v2/video_generation`)).toBe(
      true,
    )
  })

  it('V2 H3 i2v: content[] 含 first_frame image_url，本地 file 不走 mm_file 时用 URL', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.image_to_video')!
    const fetchImpl = mockFetch(async (url) => {
      if (url === `${ENDPOINT}/v2/video_generation`) return jsonRes({ task_id: 'h3-2' })
      if (url.includes('/v2/query/video_generation/')) {
        return jsonRes({ task: { status: 'succeeded', content: { url: 'https://cdn/h3i.mp4' } } })
      }
      if (url === 'https://cdn/h3i.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: '镜头推进',
        inputFiles: [{ type: 'image', url: 'https://cdn/first.png', role: 'first_frame' }],
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: 'MiniMax-H3',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
      }),
    )
    const body = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v2/video_generation`)?.[1]
        ?.body as string,
    )
    expect(body.content).toEqual([
      { type: 'text', text: '镜头推进' },
      { type: 'image_url', image_url: { url: 'https://cdn/first.png' }, role: 'first_frame' },
    ])
    expect(body.ratio).toBe('adaptive')
  })

  it('V2 H3 i2v: 用户选的画幅/时长生效（compile 改名后 ratio+aspectRatio 并存时取用户值）', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.image_to_video')!
    const fetchImpl = mockFetch(async (url) => {
      if (url === `${ENDPOINT}/v2/video_generation`) return jsonRes({ task_id: 'h3-ratio' })
      if (url.includes('/v2/query/video_generation/')) {
        return jsonRes({ task: { status: 'succeeded', content: { url: 'https://cdn/h3r.mp4' } } })
      }
      if (url === 'https://cdn/h3r.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: '测试画幅',
        inputFiles: [{ type: 'image', url: 'https://cdn/first.png', role: 'first_frame' }],
        modelParams: {
          // 模拟公共 compiler 改名后的 canonicalParams 现场：
          // capability.defaults 的 ratio/duration 未改名 + 用户值被改名为 aspectRatio/durationSeconds，两键并存。
          ratio: 'adaptive',
          aspectRatio: '3:4',
          duration: 5,
          durationSeconds: 10,
          resolution: '2K',
        },
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: 'MiniMax-H3',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
      }),
    )
    const body = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v2/video_generation`)?.[1]
        ?.body as string,
    )
    // 用户选的 3:4 必须生效，不能被默认 adaptive 覆盖
    expect(body.ratio).toBe('3:4')
    // 用户选的 10s 必须生效，不能被默认 5s 覆盖
    expect(body.duration).toBe(10)
  })

  it('V2 错误归一: HTTP 422 + OAI error.type=unprocessable_entity_error → content_policy_blocked', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')!
    const fetchImpl = mockFetch(async () =>
      jsonRes(
        {
          type: 'error',
          error: {
            type: 'unprocessable_entity_error',
            message: 'sensitive content (1026)',
            http_code: '422',
          },
          request_id: 'req-h3',
        },
        422,
      ),
    )
    await expect(
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({
          operation: 'text_to_video',
          capability: 'video.generate',
          modelParams: { ratio: '16:9' },
          outputDir: tmpDir,
        }),
        makeContext({
          defaultModel: 'MiniMax-H3',
          mediaApiType: 'async',
          fetch: fetchImpl,
          mediaManifest: manifest,
          mediaManifestCapability: cap,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'MediaProviderError',
      statusCode: 422,
      normalized: expect.objectContaining({ code: 'content_policy_blocked' }),
    })
  })

  it('视频 Agent 模板: template_id 分流到 /v1/video_template_generation，取 video_url', async () => {
    const manifest = findManifest('minimax:hailuo-template')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url === `${ENDPOINT}/v1/video_template_generation`) {
        return jsonRes({ task_id: 'tpl-1', base_resp: { status_code: 0 } })
      }
      if (url.includes('/v1/query/video_template_generation')) {
        return jsonRes({
          task_id: 'tpl-1',
          status: 'Success',
          video_url: 'https://cdn/tpl.mp4',
          base_resp: { status_code: 0 },
        })
      }
      if (url === 'https://cdn/tpl.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: '狮子',
        inputFiles: [{ type: 'image', url: 'https://cdn/pet.jpeg', role: 'reference' }],
        modelParams: { templateId: '393769180141805569' },
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: 'video-agent',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
      }),
    )
    expect(out.mode).toBe('async')
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
    const body = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v1/video_template_generation`)?.[1]
        ?.body as string,
    )
    expect(body).toEqual({
      template_id: '393769180141805569',
      media_inputs: [{ value: 'https://cdn/pet.jpeg' }],
      text_inputs: [{ value: '狮子' }],
    })
  })

  it('validator: image.edit 缺参考图 / 2.3-Fast 禁 t2v / V2 t2v ratio=adaptive / V2 r2v 仅音频 / 模板非法 id', () => {
    // image.edit 缺参考图
    const editCtx = manifestContext('minimax:image-01', 'image.edit')
    expect(
      validateMediaRequest({
        input: makeInput({ operation: 'image_to_image', capability: 'image.edit' }),
        providerKind: 'minimax-hailuo',
        modelId: editCtx.defaultModel,
        capability: 'image.edit',
        manifest: editCtx.mediaManifest,
        manifestCapability: editCtx.mediaManifestCapability,
        mode: 'adapter',
      }).blockingIssues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_required' })]))

    // 2.3-Fast 禁止 t2v
    const fastCtx = manifestContext('minimax:hailuo-2.3-fast', 'video.image_to_video')
    expect(
      validateMediaRequest({
        input: makeInput({ operation: 'text_to_video', capability: 'video.generate' }),
        providerKind: 'minimax-hailuo',
        modelId: fastCtx.defaultModel,
        capability: 'video.generate',
        manifest: findManifest('minimax:hailuo-2.3-fast'),
        manifestCapability: undefined,
        mode: 'adapter',
      }).blockingIssues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'forbidden_param' })]))

    // V2 t2v ratio=adaptive 阻断
    const h3GenCtx = manifestContext('minimax:v2-h3', 'video.generate')
    expect(
      validateMediaRequest({
        input: makeInput({
          operation: 'text_to_video',
          capability: 'video.generate',
          modelParams: { ratio: 'adaptive' },
        }),
        providerKind: 'minimax-hailuo',
        modelId: h3GenCtx.defaultModel,
        capability: 'video.generate',
        manifest: h3GenCtx.mediaManifest,
        manifestCapability: h3GenCtx.mediaManifestCapability,
        mode: 'adapter',
      }).blockingIssues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_enum' })]))

    // V2 r2v 仅音频阻断
    const h3RefCtx = manifestContext('minimax:v2-h3', 'video.reference_to_video')
    expect(
      validateMediaRequest({
        input: makeInput({
          operation: 'text_to_video',
          capability: 'video.reference_to_video',
          inputFiles: [{ type: 'audio', url: 'https://cdn/a.mp3', role: 'reference' }],
        }),
        providerKind: 'minimax-hailuo',
        modelId: h3RefCtx.defaultModel,
        capability: 'video.reference_to_video',
        manifest: h3RefCtx.mediaManifest,
        manifestCapability: h3RefCtx.mediaManifestCapability,
        mode: 'adapter',
      }).blockingIssues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_required' })]))

    // 模板非法 templateId
    const tplCtx = manifestContext('minimax:hailuo-template', 'video.generate')
    expect(
      validateMediaRequest({
        input: makeInput({
          operation: 'text_to_video',
          capability: 'video.generate',
          prompt: 'x',
          modelParams: { templateId: 'not-a-real-template' },
        }),
        providerKind: 'minimax-hailuo',
        modelId: tplCtx.defaultModel,
        capability: 'video.generate',
        manifest: tplCtx.mediaManifest,
        manifestCapability: tplCtx.mediaManifestCapability,
        mode: 'adapter',
      }).blockingIssues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid_enum' })]))
  })

  it('validator: v1 枚举组合、H3 必需输入和模板空输入均被阻断', () => {
    const validate = (
      manifestId: string,
      capability: MediaCapabilityId,
      input: Partial<MediaGenerateInput>,
    ) => {
      const context = manifestContext(manifestId, capability)
      return validateMediaRequest({
        input: makeInput({ capability, ...input }),
        providerKind: 'minimax-hailuo',
        modelId: context.defaultModel,
        capability,
        manifest: context.mediaManifest,
        manifestCapability: context.mediaManifestCapability,
        mode: 'adapter',
      }).blockingIssues
    }

    expect(
      validate('minimax:hailuo-2.3', 'video.generate', {
        operation: 'text_to_video',
        prompt: '测试',
        modelParams: { durationSeconds: 7, resolution: '768P' },
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'out_of_range' })]))

    expect(
      validate('minimax:hailuo-2.3', 'video.generate', {
        operation: 'text_to_video',
        prompt: '测试',
        modelParams: { durationSeconds: 10, resolution: '1080P' },
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'conflicting_params' })]))

    expect(
      validate('minimax:v2-h3', 'video.image_to_video', {
        operation: 'image_to_video',
        prompt: '测试',
        inputFiles: [],
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_required' })]))

    expect(
      validate('minimax:hailuo-template', 'video.generate', {
        operation: 'text_to_video',
        prompt: '',
        modelParams: { templateId: '393769180141805569' },
        inputFiles: [],
      }),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_required' })]))
  })

  it('v1 视频 task failed: query 返回 Fail → 抛 MediaProviderError(task_failed)', async () => {
    const manifest = findManifest('minimax:hailuo-2.3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url === `${ENDPOINT}/v1/video_generation`) {
        return jsonRes({ task_id: 't-fail', base_resp: { status_code: 0 } })
      }
      if (url.includes('/v1/query/video_generation')) {
        return jsonRes({ task_id: 't-fail', status: 'Fail', base_resp: { status_code: 0 } })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    await expect(
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({
          operation: 'text_to_video',
          capability: 'video.generate',
          outputDir: tmpDir,
        }),
        makeContext({
          defaultModel: 'MiniMax-Hailuo-2.3',
          mediaApiType: 'async',
          fetch: fetchImpl,
          mediaManifest: manifest,
          mediaManifestCapability: cap,
          mediaDefaults: { polling: { intervalMs: 1 } },
        }),
      ),
    ).rejects.toBeInstanceOf(MediaProviderError)
  })

  it('V2 本地文件链路: dataUrl 图 → Files upload → content[].image_url.url = mm_file://{file_id}', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.image_to_video')!
    const fetchImpl = mockFetch(async (url) => {
      // 本地图（dataUrl）→ media-input 走 upload → mm_file://
      if (url === `${ENDPOINT}/v1/files/upload`) {
        return rawJsonRes(
          '{\u0022file\u0022:{\u0022file_id\u0022:398574688191234048,\u0022bytes\u0022:100,\u0022filename\u0022:\u0022in.png\u0022,\u0022purpose\u0022:\u0022video_generation_input\u0022},\u0022base_resp\u0022:{\u0022status_code\u0022:0,\u0022status_msg\u0022:\u0022success\u0022}}',
        )
      }
      if (url === `${ENDPOINT}/v2/video_generation`) return jsonRes({ task_id: 'h3-up' })
      if (url.includes('/v2/query/video_generation/')) {
        return jsonRes({ task: { status: 'succeeded', content: { url: 'https://cdn/up.mp4' } } })
      }
      if (url === 'https://cdn/up.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: '动起来',
        inputFiles: [
          {
            type: 'image',
            role: 'first_frame',
            dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
            mimeType: 'image/png',
          },
        ],
        outputDir: tmpDir,
      }),
      makeContext({
        apiEndpoint: `${ENDPOINT}/v2`,
        defaultModel: 'MiniMax-H3',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
      }),
    )
    const uploadCall = fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v1/files/upload`)
    expect(uploadCall).toBeTruthy()
    const createBody = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v2/video_generation`)?.[1]
        ?.body as string,
    )
    // file_id(int64) 经 files client 字符串透传后拼成 mm_file://，避免 JS number 精度丢失
    expect(createBody.content).toEqual([
      { type: 'text', text: '动起来' },
      {
        type: 'image_url',
        image_url: { url: 'mm_file://398574688191234048' },
        role: 'first_frame',
      },
    ])
  })

  it('V2 H3 本地视频: 官方 Files 上传失败 → 回退 Spark 平台公开上传（https URL）', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.reference_to_video')!
    const localVideoPath = path.join(tmpDir, 'ref-motion.mp4')
    writeFileSync(localVideoPath, FAKE_MP4)
    const uploads: Array<Record<string, unknown>> = []
    const fetchImpl = mockFetch(async (url) => {
      // 官方 Files 上传失败（HTTP 401）
      if (url === `${ENDPOINT}/v1/files/upload`) {
        return jsonRes({ message: 'unauthorized' }, 401)
      }
      if (url === `${ENDPOINT}/v2/video_generation`) return jsonRes({ task_id: 'h3-ref' })
      if (url.includes('/v2/query/video_generation/')) {
        return jsonRes({ task: { status: 'succeeded', content: { url: 'https://cdn/ref.mp4' } } })
      }
      if (url === 'https://cdn/ref.mp4') return binaryRes(FAKE_MP4)
      throw new Error(`unexpected fetch ${url}`)
    })
    await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'image_to_video',
        capability: 'video.reference_to_video',
        prompt: '参照视频动起来',
        inputFiles: [
          { type: 'video', role: 'reference', mimeType: 'video/mp4', path: localVideoPath },
        ],
        outputDir: tmpDir,
      }),
      makeContext({
        apiEndpoint: `${ENDPOINT}/v2`,
        defaultModel: 'MiniMax-H3',
        mediaApiType: 'async',
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
        mediaDefaults: { polling: { intervalMs: 1 } },
        fallbackUploader: {
          canHandle: (provider) => provider === 'minimax-hailuo',
          upload: async (input) => {
            uploads.push({
              filePath: input.filePath,
              filename: input.filename,
              mimeType: input.mimeType,
              targetProvider: input.targetProvider,
            })
            return {
              provider: 'minimax-hailuo',
              publicUrl: 'https://minio.yiqibyte.com/spark-desktop/ref-motion.mp4',
            }
          },
        },
      }),
    )
    // 官方上传失败一次（HTTP 401），回退上传一次
    const officialUploadCalls = fetchImpl.mock.calls.filter(
      ([u]) => u === `${ENDPOINT}/v1/files/upload`,
    )
    expect(officialUploadCalls).toHaveLength(1)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({
      filePath: localVideoPath,
      filename: 'ref-motion.mp4',
      mimeType: 'video/mp4',
      targetProvider: 'minimax-hailuo',
    })
    const createBody = JSON.parse(
      fetchImpl.mock.calls.find(([u]) => u === `${ENDPOINT}/v2/video_generation`)?.[1]
        ?.body as string,
    )
    expect(createBody.content).toEqual([
      { type: 'text', text: '参照视频动起来' },
      {
        type: 'video_url',
        video_url: { url: 'https://minio.yiqibyte.com/spark-desktop/ref-motion.mp4' },
        role: 'reference_video',
      },
    ])
  })

  it('V2 H3 cancelled 终态: query 返回 cancelled → 立即抛错（不轮询到超时）', async () => {
    const manifest = findManifest('minimax:v2-h3')
    const cap = manifest.capabilities.find((c) => c.id === 'video.generate')!
    const fetchImpl = mockFetch(async (url) => {
      if (url === `${ENDPOINT}/v2/video_generation`) return jsonRes({ task_id: 'h3-c' })
      if (url.includes('/v2/query/video_generation/')) {
        return jsonRes({ task: { id: 'h3-c', status: 'cancelled' } })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    await expect(
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({
          operation: 'text_to_video',
          capability: 'video.generate',
          modelParams: { ratio: '16:9' },
          outputDir: tmpDir,
        }),
        makeContext({
          defaultModel: 'MiniMax-H3',
          mediaApiType: 'async',
          fetch: fetchImpl,
          mediaManifest: manifest,
          mediaManifestCapability: cap,
          mediaDefaults: { polling: { intervalMs: 1 } },
        }),
      ),
    ).rejects.toThrow(/Task failed/)
  })

  it('validator: V2 H3 单文件超限阻断（图>30MB / 视频>50MB / 音频>15MB）', () => {
    const refCtx = manifestContext('minimax:v2-h3', 'video.reference_to_video')
    const mkIssues = (files: MediaInputFile[]) =>
      validateMediaRequest({
        input: makeInput({
          operation: 'text_to_video',
          capability: 'video.reference_to_video',
          prompt: '参考生成',
          inputFiles: files,
        }),
        providerKind: 'minimax-hailuo',
        modelId: refCtx.defaultModel,
        capability: 'video.reference_to_video',
        manifest: refCtx.mediaManifest,
        manifestCapability: refCtx.mediaManifestCapability,
        mode: 'adapter',
      }).blockingIssues

    // 图片 >30MB
    expect(
      mkIssues([
        { type: 'image', url: 'https://cdn/a.png', role: 'reference', sizeBytes: 31 * 1024 * 1024 },
      ]),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'out_of_range' })]))
    // 视频 >50MB
    expect(
      mkIssues([
        { type: 'video', url: 'https://cdn/a.mp4', role: 'reference', sizeBytes: 51 * 1024 * 1024 },
      ]),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'out_of_range' })]))
    // 音频 >15MB（需配一张合法参考图，否则先触发 r2v"仅音频"missing_required）
    expect(
      mkIssues([
        { type: 'image', url: 'https://cdn/ok.png', role: 'reference' },
        { type: 'audio', url: 'https://cdn/a.mp3', role: 'reference', sizeBytes: 16 * 1024 * 1024 },
      ]),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'out_of_range' })]))
  })

  // ─── 音频（speech T2A / music，/v1 通道，同步）──────────────────────────────
  // 文档：docs/integrations/minimax/speech-music.md §1（T2A HTTP）/ §6（Music）。

  it('audio.speech(T2A) url 路径: POST /v1/t2a_v2，data.audio 为下载 URL，落盘 mp3', async () => {
    const manifest = findManifest('minimax:speech-2.8-hd')
    const cap = manifest.capabilities.find((c) => c.id === 'audio.speech')!
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/t2a_v2')) {
        return jsonRes({
          data: { audio: 'https://cdn/tts.mp3', status: 2 },
          extra_info: { audio_length: 1200, audio_format: 'mp3' },
          base_resp: { status_code: 0, status_msg: 'success' },
        })
      }
      if (url === 'https://cdn/tts.mp3') return binaryRes(FAKE_MP3)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_audio',
        capability: 'audio.speech',
        prompt: '你好世界',
        modelParams: { voice: 'male-qn-qingse', emotion: 'happy' },
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
    )
    expect(out.mode).toBe('sync')
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]?.type).toBe('audio')
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
    const post = fetchImpl.mock.calls.find(([u]) => u.endsWith('/v1/t2a_v2'))?.[1]
    expect(JSON.parse(post?.body as string)).toMatchObject({
      model: 'speech-2.8-hd',
      text: '你好世界',
      stream: false,
      output_format: 'url',
      voice_setting: { voice_id: 'male-qn-qingse', emotion: 'happy' },
      audio_setting: { format: 'mp3' },
    })
  })

  it('audio.speech(T2A) hex 路径: data.audio 为 hex 字符串，Buffer.from(hex) 落盘', async () => {
    const manifest = findManifest('minimax:speech-2.8-hd')
    const cap = manifest.capabilities.find((c) => c.id === 'audio.speech')!
    const hexAudio = FAKE_MP3.toString('hex')
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/t2a_v2')) {
        return jsonRes({
          data: { audio: hexAudio, status: 2 },
          base_resp: { status_code: 0, status_msg: 'success' },
        })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_audio',
        capability: 'audio.speech',
        prompt: 'hex 测试',
        modelParams: { voice: 'female-shaonv', output_format: 'hex' },
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
    )
    expect(out.assets).toHaveLength(1)
    const file = out.assets[0]?.filePath ?? ''
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file).equals(FAKE_MP3)).toBe(true)
    const post = fetchImpl.mock.calls.find(([u]) => u.endsWith('/v1/t2a_v2'))?.[1]
    expect(JSON.parse(post?.body as string).output_format).toBe('hex')
  })

  it('audio.speech voice 缺失: modelParams 与 mediaDefaults 均无 voice → invalid_input', async () => {
    const manifest = findManifest('minimax:speech-2.8-hd')
    const cap = manifest.capabilities.find((c) => c.id === 'audio.speech')!
    const fetchImpl = mockFetch(async () => jsonRes({ base_resp: { status_code: 0 } }))
    await expect(
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({
          operation: 'text_to_audio',
          capability: 'audio.speech',
          prompt: '无音色',
          outputDir: tmpDir,
        }),
        makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
      ),
    ).rejects.toMatchObject({ name: 'MediaProviderError', code: 'invalid_input' })
  })

  it('audio.music: POST /v1/music_generation，prompt + lyrics 落盘音频', async () => {
    const manifest = findManifest('minimax:music-2.6')
    const cap = manifest.capabilities.find((c) => c.id === 'audio.music')!
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/music_generation')) {
        return jsonRes({
          data: { audio: 'https://cdn/music.mp3', status: 2 },
          extra_info: { music_duration: 25364 },
          base_resp: { status_code: 0, status_msg: 'success' },
        })
      }
      if (url === 'https://cdn/music.mp3') return binaryRes(FAKE_MP3)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_audio',
        capability: 'audio.music',
        prompt: '轻快的钢琴曲',
        modelParams: { lyrics: '[Verse 1]\n歌词一行', is_instrumental: false, format: 'wav' },
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
    )
    expect(out.mode).toBe('sync')
    expect(out.assets[0]?.type).toBe('audio')
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
    const post = fetchImpl.mock.calls.find(([u]) => u.endsWith('/v1/music_generation'))?.[1]
    expect(JSON.parse(post?.body as string)).toMatchObject({
      model: 'music-2.6',
      prompt: '轻快的钢琴曲',
      lyrics: '[Verse 1]\n歌词一行',
      is_instrumental: false,
      // audio_setting.format 必须随用户选择传入（§6.1），否则格式静默丢失
      audio_setting: { format: 'wav' },
    })
  })

  it('audio.music url 模式 data.audio 缺失时回退 data.url（字段名官方未定义，文档 L461/L535）', async () => {
    const manifest = findManifest('minimax:music-2.6')
    const cap = manifest.capabilities.find((c) => c.id === 'audio.music')!
    const fetchImpl = mockFetch(async (url) => {
      if (url.endsWith('/v1/music_generation')) {
        // data 无 audio 字段，仅 data.url（模拟官方 url 模式另一种可能字段名）
        return jsonRes({
          data: { url: 'https://cdn/music-fallback.mp3', status: 2 },
          base_resp: { status_code: 0, status_msg: 'success' },
        })
      }
      if (url === 'https://cdn/music-fallback.mp3') return binaryRes(FAKE_MP3)
      throw new Error(`unexpected fetch ${url}`)
    })
    const out = await new MinimaxHailuoMediaAdapter().invoke(
      makeInput({
        operation: 'text_to_audio',
        capability: 'audio.music',
        prompt: '回退测试',
        outputDir: tmpDir,
      }),
      makeContext({
        defaultModel: manifest.modelId,
        fetch: fetchImpl,
        mediaManifest: manifest,
        mediaManifestCapability: cap,
      }),
    )
    expect(out.assets).toHaveLength(1)
    expect(existsSync(out.assets[0]?.filePath ?? '')).toBe(true)
  })

  it('audio base_resp 错误归一: 1004→auth_failed / 1026→content_policy_blocked / 2013→invalid_parameter_value', async () => {
    const speechManifest = findManifest('minimax:speech-2.8-hd')
    const speechCap = speechManifest.capabilities.find((c) => c.id === 'audio.speech')!
    const musicManifest = findManifest('minimax:music-2.6')
    const musicCap = musicManifest.capabilities.find((c) => c.id === 'audio.music')!

    // 1004 鉴权失败（T2A HTTP 子集含 1004）
    await expect(
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({
          operation: 'text_to_audio',
          capability: 'audio.speech',
          prompt: 'x',
          modelParams: { voice: 'male-qn-qingse' },
          outputDir: tmpDir,
        }),
        makeContext({
          fetch: mockFetch(async () =>
            jsonRes({ base_resp: { status_code: 1004, status_msg: '鉴权失败' } }),
          ),
          mediaManifest: speechManifest,
          mediaManifestCapability: speechCap,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'MediaProviderError',
      normalized: { code: 'auth_failed', providerCode: '1004' },
    })

    // 1026 内容违规（Music 子集含 1026；T2A HTTP 子集不含，故用 music 验证）
    await expect(
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({
          operation: 'text_to_audio',
          capability: 'audio.music',
          prompt: 'x',
          outputDir: tmpDir,
        }),
        makeContext({
          fetch: mockFetch(async () =>
            jsonRes({ base_resp: { status_code: 1026, status_msg: '涉及敏感内容' } }),
          ),
          mediaManifest: musicManifest,
          mediaManifestCapability: musicCap,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'MediaProviderError',
      normalized: { code: 'content_policy_blocked', providerCode: '1026' },
    })

    // 2013 参数错误（两接口子集均含）
    await expect(
      new MinimaxHailuoMediaAdapter().invoke(
        makeInput({
          operation: 'text_to_audio',
          capability: 'audio.music',
          prompt: 'x',
          outputDir: tmpDir,
        }),
        makeContext({
          fetch: mockFetch(async () =>
            jsonRes({ base_resp: { status_code: 2013, status_msg: '参数异常' } }),
          ),
          mediaManifest: musicManifest,
          mediaManifestCapability: musicCap,
        }),
      ),
    ).rejects.toMatchObject({
      name: 'MediaProviderError',
      normalized: { code: 'invalid_parameter_value', providerCode: '2013' },
    })
  })
})
