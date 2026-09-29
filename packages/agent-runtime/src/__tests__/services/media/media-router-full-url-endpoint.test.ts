import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MediaCapabilityId, MediaModelManifest } from '@spark/protocol'
import {
  MediaRouterService,
  type MediaProviderProfile,
} from '../../../services/media/media-router.service.js'

/**
 * 「完整 URL」开关（apiEndpointFullUrl）在多媒体链路的语义：
 * 主调用（提交/生成）原样发送所填地址；上传、下载、轮询等从属请求保持既有派生逻辑。
 */

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function makeManifest(
  response: MediaModelManifest['invocation']['response'],
  method: 'POST' | 'PUT' = 'POST',
): MediaModelManifest {
  return {
    id: 'custom:v2-image:full-url-channel',
    providerKind: 'custom',
    modelId: 'v2-image',
    displayName: 'V2 image template',
    contractVersion: 2,
    adapterMode: 'template',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: 'Generate image',
        input: { required: ['prompt'] },
        output: { types: ['image'] },
        paramSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ],
    invocation: {
      mode: response.kind === 'task_poll' ? 'async_polling' : 'sync',
      endpoint: '/images',
      method,
      contentType: 'json',
      requestTemplate: {},
      request: {
        method,
        endpoint: '/images',
        auth: { kind: 'bearer', credentialRef: 'apiKey' },
        body: {
          kind: 'json',
          template: { model: '{{modelId}}', prompt: '{{prompt}}' },
        },
      },
      response,
      ...(response.kind === 'task_poll'
        ? {
            polling: {
              intervalMs: 1,
              timeoutMs: 1_000,
              maxAttempts: 5,
              unknownStatus: 'fail' as const,
              statusMap: {
                queued: 'queued' as const,
                running: 'running' as const,
                succeeded: 'succeeded' as const,
                failed: 'failed' as const,
              },
            },
          }
        : {}),
    },
    docs: { sourceUrls: [] },
  }
}

function makeProvider(
  manifest: MediaModelManifest,
  overrides: Partial<MediaProviderProfile> = {},
): MediaProviderProfile {
  return {
    id: 'custom-full-url-provider',
    name: 'Custom full URL provider',
    defaultModel: manifest.modelId,
    apiEndpoint: 'https://provider.example/v1',
    mediaProvider: 'custom',
    mediaCapabilities: manifest.capabilities.map(
      (capability) => capability.id,
    ) as MediaCapabilityId[],
    mediaModelManifests: [manifest],
    apiKey: 'secret-token',
    mediaDefaults: { polling: { intervalMs: 1 } },
    ...overrides,
  }
}

function makeInput(outputDir: string) {
  return {
    operation: 'text_to_image' as const,
    capability: 'image.generate' as const,
    prompt: 'a red fox',
    outputDir,
  }
}

describe('MediaRouterService — 渠道「完整 URL」主调用覆盖', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  function newOutputDir(prefix: string): string {
    const directory = mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(directory)
    return directory
  }

  it('未开启开关时保持既有拼接行为（增量向后兼容）', async () => {
    const outputDir = newOutputDir('spark-full-url-off-')
    const manifest = makeManifest({ kind: 'inline_base64', jsonPaths: ['data[].b64_json'] })
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('https://provider.example/v1/images')
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_PIXEL }] }), { status: 200 })
    })

    await new MediaRouterService().invoke(makeInput(outputDir), {
      providers: [makeProvider(manifest)],
      providerProfileId: 'custom-full-url-provider',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('开启开关后主调用原样发送所填完整地址，不再拼接 manifest 相对端点', async () => {
    const outputDir = newOutputDir('spark-full-url-on-')
    const manifest = makeManifest({ kind: 'inline_base64', jsonPaths: ['data[].b64_json'] })
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://provider.example/coding/v3/messages')
      expect(init?.method).toBe('POST')
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_PIXEL }] }), { status: 200 })
    })

    const result = await new MediaRouterService().invoke(makeInput(outputDir), {
      providers: [
        makeProvider(manifest, {
          apiEndpoint: 'https://provider.example/coding/v3/messages',
          apiEndpointFullUrl: true,
        }),
      ],
      providerProfileId: 'custom-full-url-provider',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.output.assets).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('开启开关后从属轮询请求仍按原地址派生，不套用完整 URL', async () => {
    const outputDir = newOutputDir('spark-full-url-poll-')
    const manifest = makeManifest({
      kind: 'task_poll',
      taskIdPaths: ['id'],
      statusPaths: ['status'],
      resultPaths: ['data[].b64_json'],
      poll: {
        method: 'GET',
        endpoint: '/jobs/{taskId}',
        auth: { kind: 'inherit' },
        body: { kind: 'none' },
      },
      taskId: { location: 'path', name: 'taskId' },
    })
    let pollCount = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') {
        expect(url).toBe('https://provider.example/full/generate')
        return new Response(JSON.stringify({ id: 'task/1' }), { status: 200 })
      }
      pollCount += 1
      // 从属请求保持既有派生逻辑：以 apiEndpoint 为 base 拼 polling 路径。
      expect(url).toBe('https://provider.example/full/generate/jobs/task%2F1')
      return new Response(
        JSON.stringify(
          pollCount === 1
            ? { status: 'running' }
            : { status: 'succeeded', data: [{ b64_json: PNG_PIXEL }] },
        ),
        { status: 200 },
      )
    })

    const result = await new MediaRouterService().invoke(makeInput(outputDir), {
      providers: [
        makeProvider(manifest, {
          apiEndpoint: 'https://provider.example/full/generate',
          apiEndpointFullUrl: true,
        }),
      ],
      providerProfileId: 'custom-full-url-provider',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.output.mode).toBe('async')
    expect(pollCount).toBe(2)
    const assetFilePath = result.output.assets[0]?.filePath ?? ''
    expect(assetFilePath).not.toBe('')
    expect(readFileSync(assetFilePath).length).toBeGreaterThan(0)
  })

  it('非 GET 的 manifest 主调用（如 PUT）同样按完整 URL 原样发送', async () => {
    const outputDir = newOutputDir('spark-full-url-put-')
    const manifest = makeManifest({ kind: 'inline_base64', jsonPaths: ['data[].b64_json'] }, 'PUT')
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://provider.example/full/generate')
      expect(init?.method).toBe('PUT')
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_PIXEL }] }), { status: 200 })
    })

    await new MediaRouterService().invoke(makeInput(outputDir), {
      providers: [
        makeProvider(manifest, {
          apiEndpoint: 'https://provider.example/full/generate',
          apiEndpointFullUrl: true,
        }),
      ],
      providerProfileId: 'custom-full-url-provider',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['tasks', 'https://provider.example/api/tasks/submit'],
    ['files', 'https://provider.example/api/files/v1'],
    ['uploads', 'https://provider.example/api/uploads/v1'],
  ])(
    '所填地址自身含 /%s 片段时主调用仍按原样发送，不被误判成从属请求',
    async (_segment: string, apiEndpoint: string) => {
      const outputDir = newOutputDir('spark-full-url-keyword-')
      const manifest = makeManifest({ kind: 'inline_base64', jsonPaths: ['data[].b64_json'] })
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        expect(String(input)).toBe(apiEndpoint)
        return new Response(JSON.stringify({ data: [{ b64_json: PNG_PIXEL }] }), { status: 200 })
      })

      await new MediaRouterService().invoke(makeInput(outputDir), {
        providers: [makeProvider(manifest, { apiEndpoint, apiEndpointFullUrl: true })],
        providerProfileId: 'custom-full-url-provider',
        fetch: fetchMock as unknown as typeof fetch,
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )
  it('开启开关后，同一次调用内的 POST 轮询不被改写成主调用地址（回归）', async () => {
    const outputDir = newOutputDir('spark-full-url-post-poll-')
    const manifest = makeManifest({
      kind: 'task_poll',
      taskIdPaths: ['id'],
      statusPaths: ['status'],
      resultPaths: ['data[].b64_json'],
      poll: {
        method: 'POST',
        endpoint: '/jobs/query',
        auth: { kind: 'inherit' },
        body: { kind: 'json', template: { id: '{{taskId}}' } },
      },
      taskId: { location: 'body', name: 'id' },
    })
    let pollCount = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      expect(init?.method).toBe('POST')
      if (url === 'https://provider.example/full/generate') {
        return new Response(JSON.stringify({ id: 'task-1' }), { status: 200 })
      }
      // POST 轮询必须保持派生地址，否则会拿回提交响应而误判任务状态。
      expect(url).toBe('https://provider.example/full/generate/jobs/query')
      pollCount += 1
      return new Response(
        JSON.stringify(
          pollCount === 1
            ? { status: 'running' }
            : { status: 'succeeded', data: [{ b64_json: PNG_PIXEL }] },
        ),
        { status: 200 },
      )
    })

    const result = await new MediaRouterService().invoke(makeInput(outputDir), {
      providers: [
        makeProvider(manifest, {
          apiEndpoint: 'https://provider.example/full/generate',
          apiEndpointFullUrl: true,
        }),
      ],
      providerProfileId: 'custom-full-url-provider',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(pollCount).toBe(2)
    expect(result.output.assets).toHaveLength(1)
  })

  it('同一主调用地址被重发时仍按完整 URL 改写（重试不被降级为从属请求）', async () => {
    const outputDir = newOutputDir('spark-full-url-retry-')
    // poll 端点与主调用端点相同 → 复现「同一地址被再次请求」的重试语义。
    const manifest = makeManifest({
      kind: 'task_poll',
      taskIdPaths: ['id'],
      statusPaths: ['status'],
      resultPaths: ['data[].b64_json'],
      poll: {
        method: 'POST',
        endpoint: '/images',
        auth: { kind: 'inherit' },
        body: { kind: 'json', template: { id: '{{taskId}}' } },
      },
      taskId: { location: 'body', name: 'id' },
    })
    const seen: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      seen.push(String(input))
      const isSubmit = seen.length === 1
      return new Response(
        JSON.stringify(
          isSubmit ? { id: 'task-1' } : { status: 'succeeded', data: [{ b64_json: PNG_PIXEL }] },
        ),
        { status: 200 },
      )
    })

    await new MediaRouterService().invoke(makeInput(outputDir), {
      providers: [
        makeProvider(manifest, {
          apiEndpoint: 'https://provider.example/full/generate',
          apiEndpointFullUrl: true,
        }),
      ],
      providerProfileId: 'custom-full-url-provider',
      fetch: fetchMock as unknown as typeof fetch,
    })

    // 两次请求都是所填完整地址：同地址重发不被降级为从属请求。
    expect(seen).toEqual([
      'https://provider.example/full/generate',
      'https://provider.example/full/generate',
    ])
  })
  it('原生渠道（tencent-tokenhub）的 POST 轮询同样保持派生地址', async () => {
    const outputDir = newOutputDir('spark-full-url-tencent-')
    const manifest: MediaModelManifest = {
      id: 'tencent:hy-image-v3.0',
      providerKind: 'tencent-tokenhub',
      modelId: 'hy-image-v3.0',
      displayName: 'Tencent async image',
      contractVersion: 2,
      adapterMode: 'native',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: 'Generate image',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: { type: 'object', additionalProperties: false, properties: {} },
        },
      ],
      invocation: {
        mode: 'async_polling',
        endpoint: '/v1/api/image/submit',
        method: 'POST',
        contentType: 'json',
        requestTemplate: {},
        request: {
          method: 'POST',
          endpoint: '/v1/api/image/submit',
          auth: { kind: 'bearer', credentialRef: 'apiKey' },
          body: { kind: 'json', template: { model: '{{modelId}}', prompt: '{{prompt}}' } },
        },
        response: { kind: 'inline_base64', jsonPaths: ['data[].b64_json'] },
      },
      docs: { sourceUrls: [] },
    }
    const seen: string[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      const method = (init?.method ?? 'GET').toUpperCase()
      if (method === 'POST') seen.push(url)
      if (method === 'POST' && url === 'https://provider.example/full/generate') {
        return new Response(JSON.stringify({ id: 'task-1' }), { status: 200 })
      }
      if (method === 'POST') {
        // TokenHub query 是 POST：必须保持派生地址，不能被改写成提交地址。
        expect(url).toBe('https://provider.example/full/generate/v1/api/image/query')
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/img.png' }] }), {
          status: 200,
        })
      }
      expect(url).toBe('https://cdn.example/img.png')
      return new Response(new Uint8Array(Buffer.from(PNG_PIXEL, 'base64')), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      })
    })

    const result = await new MediaRouterService().invoke(makeInput(outputDir), {
      providers: [
        makeProvider(manifest, {
          mediaProvider: 'tencent-tokenhub',
          defaultModel: 'hy-image-v3.0',
          apiEndpoint: 'https://provider.example/full/generate',
          apiEndpointFullUrl: true,
        }),
      ],
      providerProfileId: 'custom-full-url-provider',
      fetch: fetchMock as unknown as typeof fetch,
      skipValidation: true,
    })

    expect(result.output.assets).toHaveLength(1)
    expect(seen).toEqual([
      'https://provider.example/full/generate',
      'https://provider.example/full/generate/v1/api/image/query',
    ])
  })
})
