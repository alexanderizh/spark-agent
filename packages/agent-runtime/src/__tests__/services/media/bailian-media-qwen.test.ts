import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MediaRouterService } from '../../../services/media/media-router.service.js'
import type { MediaProviderProfile } from '../../../services/media/media-router.service.js'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'

/**
 * 百炼 Qwen-Image 2.0 系列聚焦测试。
 * 独立文件：media-adapters.test.ts 已超 4000 行，按单文件体积规则不再往里堆叠。
 * 重点验证：DashScope 原生协议、size 像素星号、n 上限、3 张输入图上限、
 * 二合一路由、负面词合并，以及参数分流不污染 wan。
 */

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const ENDPOINT = 'https://workspace.cn-beijing.maas.aliyuncs.com'

function makeProvider(overrides: Partial<MediaProviderProfile> = {}): MediaProviderProfile {
  return {
    id: 'bailian-qwen',
    name: 'Bailian',
    defaultModel: 'qwen-image-2.0-pro',
    apiEndpoint: ENDPOINT,
    mediaProvider: 'bailian',
    mediaApiType: 'async',
    mediaCapabilities: ['image.generate', 'image.edit'],
    apiKey: 'sk-test',
    ...overrides,
  }
}

function makeFetch(
  routes: Array<{
    match: string
    respond: (
      init: RequestInit | undefined,
      count: number,
    ) => { ok: boolean; status: number; body: unknown; binary?: Buffer }
  }>,
): typeof fetch & { calls: Array<{ url: string; method?: string }> } {
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
    return new Response(
      body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body),
      { status: ok === false ? status || 500 : status },
    )
  }) as typeof fetch
  return Object.assign(impl, { calls }) as typeof fetch & {
    calls: Array<{ url: string; method?: string }>
  }
}

function qwenResponse(imageValue: string, requestId = 'qwen-request') {
  return {
    request_id: requestId,
    output: {
      choices: [
        { message: { content: [{ type: 'image', image: imageValue }] } },
      ],
    },
  }
}

describe('BailianMediaAdapter — Qwen-Image 2.0', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `spark-bailian-qwen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('text-to-image: sends DashScope native messages body and pixel size', async () => {
    let submitted: Record<string, unknown> | undefined
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: (init) => {
          submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`) }
        },
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:qwen-image-2.0-pro',
    )!
    const router = new MediaRouterService()

    const result = await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: '一只在月球上的猫',
        outputDir: tmpDir,
      },
      {
        providers: [
          makeProvider({
            defaultModel: manifest.modelId,
            mediaModelManifests: [manifest],
          }),
        ],
        modelId: manifest.modelId,
        fetch: fetchMock,
      },
    )

    expect(submitted).toMatchObject({
      model: 'qwen-image-2.0-pro',
      input: {
        messages: [
          { role: 'user', content: [{ text: '一只在月球上的猫' }] },
        ],
      },
      parameters: { size: '2048*2048', n: 1, prompt_extend: true, watermark: false },
    })
    // 不得出现 wan 专属字段
    const parameters = (submitted as { parameters?: Record<string, unknown> }).parameters
    expect(parameters).not.toHaveProperty('thinking_mode')
    expect(parameters).not.toHaveProperty('color_palette')
    expect(fetchMock.calls[0]?.url).toBe(
      `${ENDPOINT}/api/v1/services/aigc/multimodal-generation/generation`,
    )
    expect(result.output.requestId).toBe('qwen-request')
    expect(result.output.assets).toHaveLength(1)
  })

  it('passes through a custom pixel size (2688*1536)', async () => {
    let submitted: Record<string, unknown> | undefined
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: (init) => {
          submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`) }
        },
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:qwen-image-2.0',
    )!
    const router = new MediaRouterService()

    await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: '宽屏风景',
        outputDir: tmpDir,
        modelParams: { size: '2688*1536', n: 2 },
      },
      {
        providers: [
          makeProvider({
            defaultModel: manifest.modelId,
            mediaModelManifests: [manifest],
          }),
        ],
        modelId: manifest.modelId,
        fetch: fetchMock,
      },
    )

    expect(submitted).toMatchObject({
      model: 'qwen-image-2.0',
      parameters: { size: '2688*1536', n: 2 },
    })
  })

  it('does not reject a 2746-character prompt using the documented 1300-token reference', async () => {
    let submitted: Record<string, unknown> | undefined
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: (init) => {
          submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`) }
        },
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:qwen-image-2.0',
    )!
    const prompt = '角色设定'.repeat(686) + '结尾'

    await new MediaRouterService().invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt,
        outputDir: tmpDir,
      },
      {
        providers: [makeProvider({ defaultModel: manifest.modelId, mediaModelManifests: [manifest] })],
        modelId: manifest.modelId,
        fetch: fetchMock,
      },
    )

    expect(prompt).toHaveLength(2746)
    expect(submitted).toMatchObject({ input: { messages: [{ content: [{ text: prompt }] }] } })
  })

  it('image.edit: routes as binary-capable edit and limits to 3 input images', async () => {
    let submitted: Record<string, unknown> | undefined
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: (init) => {
          submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`) }
        },
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:qwen-image-2.0-pro',
    )!
    const router = new MediaRouterService()

    const result = await router.invoke(
      {
        operation: 'image_to_image',
        capability: 'image.edit',
        prompt: '把背景换成雪山',
        outputDir: tmpDir,
        inputFiles: [
          { type: 'image', url: 'https://cdn/a.png' },
          { type: 'image', url: 'https://cdn/b.png' },
        ],
      },
      {
        providers: [
          makeProvider({
            defaultModel: manifest.modelId,
            mediaModelManifests: [manifest],
          }),
        ],
        modelId: manifest.modelId,
        fetch: fetchMock,
      },
    )

    const content = (
      submitted as {
        input?: { messages?: Array<{ content?: Array<{ image?: string; text?: string }> }> }
      }
    ).input?.messages?.[0]?.content
    expect(content).toEqual([
      { image: 'https://cdn/a.png' },
      { image: 'https://cdn/b.png' },
      { text: '把背景换成雪山' },
    ])
    expect(result.output.assets).toHaveLength(1)
    expect(result.output.assets[0]?.filePath).toMatch(/qwen-edit/)
  })

  it('rejects 4 input images for qwen edit (max 3)', async () => {
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: () => ({ ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`) }),
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:qwen-image-2.0-pro',
    )!
    const router = new MediaRouterService()

    await expect(
      router.invoke(
        {
          operation: 'image_to_image',
          capability: 'image.edit',
          prompt: '编辑',
          outputDir: tmpDir,
          inputFiles: [
            { type: 'image', url: 'https://cdn/a.png' },
            { type: 'image', url: 'https://cdn/b.png' },
            { type: 'image', url: 'https://cdn/c.png' },
            { type: 'image', url: 'https://cdn/d.png' },
          ],
        },
        {
          providers: [
            makeProvider({
              defaultModel: manifest.modelId,
              mediaModelManifests: [manifest],
            }),
          ],
          modelId: manifest.modelId,
          fetch: fetchMock,
        },
      ),
    ).rejects.toThrow(/3 张图片/)
  })

  it('rejects n > 6 for qwen 2.0 series', async () => {
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: () => ({ ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`) }),
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:qwen-image-2.0-pro',
    )!
    const router = new MediaRouterService()

    await expect(
      router.invoke(
        {
          operation: 'text_to_image',
          capability: 'image.generate',
          prompt: 'x',
          outputDir: tmpDir,
          modelParams: { n: 7 },
        },
        {
          providers: [
            makeProvider({
              defaultModel: manifest.modelId,
              mediaModelManifests: [manifest],
            }),
          ],
          modelId: manifest.modelId,
          fetch: fetchMock,
        },
      ),
    ).rejects.toThrow(/1-6/)
  })

  it('forwards user-confirmed qwen parameter warnings to the provider', async () => {
    let submitted: Record<string, unknown> | undefined
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: (init) => {
          submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`) }
        },
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:qwen-image-2.0-pro',
    )!
    const router = new MediaRouterService()

    await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: 'x',
        outputDir: tmpDir,
        modelParams: { n: 7 },
      },
      {
        providers: [makeProvider({ defaultModel: manifest.modelId, mediaModelManifests: [manifest] })],
        modelId: manifest.modelId,
        fetch: fetchMock,
        skipValidation: true,
      },
    )

    expect(submitted).toMatchObject({ parameters: { n: 7 } })
  })

  it('rejects ratio-style size (1:1) — only pixel asterisk allowed', async () => {
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: () => ({ ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`) }),
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:qwen-image-2.0-pro',
    )!
    const router = new MediaRouterService()

    await expect(
      router.invoke(
        {
          operation: 'text_to_image',
          capability: 'image.generate',
          prompt: 'x',
          outputDir: tmpDir,
          modelParams: { size: '1:1' },
        },
        {
          providers: [
            makeProvider({
              defaultModel: manifest.modelId,
              mediaModelManifests: [manifest],
            }),
          ],
          modelId: manifest.modelId,
          fetch: fetchMock,
        },
      ),
    ).rejects.toThrow(/像素星号格式/)
  })

  it('merges input.negativePrompt into parameters.negative_prompt', async () => {
    let submitted: Record<string, unknown> | undefined
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: (init) => {
          submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`) }
        },
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:qwen-image-2.0-pro',
    )!
    const router = new MediaRouterService()

    await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: '一只猫',
        negativePrompt: '模糊',
        outputDir: tmpDir,
      },
      {
        providers: [
          makeProvider({
            defaultModel: manifest.modelId,
            mediaModelManifests: [manifest],
          }),
        ],
        modelId: manifest.modelId,
        fetch: fetchMock,
      },
    )

    expect(
      (submitted as { parameters?: Record<string, unknown> }).parameters,
    ).toMatchObject({ negative_prompt: '模糊' })
  })

  it('regression: wan2.7-image-pro still uses 1K/2K/4K and is unaffected by qwen branch', async () => {
    let submitted: Record<string, unknown> | undefined
    const fetchMock = makeFetch([
      {
        match: '/multimodal-generation/generation',
        respond: (init) => {
          submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          return { ok: true, status: 200, body: qwenResponse(`data:image/png;base64,${PNG_PIXEL}`, 'wan-req') }
        },
      },
    ])
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:wan2.7-image-pro',
    )!
    const router = new MediaRouterService()

    await router.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: 'a flower',
        outputDir: tmpDir,
        modelParams: { size: '4K', n: 1, thinking_mode: true },
      },
      {
        providers: [
          makeProvider({
            defaultModel: manifest.modelId,
            mediaModelManifests: [manifest],
          }),
        ],
        modelId: manifest.modelId,
        fetch: fetchMock,
      },
    )

    expect(submitted).toMatchObject({
      model: 'wan2.7-image-pro',
      parameters: { size: '4K', n: 1, thinking_mode: true },
    })
  })
})
