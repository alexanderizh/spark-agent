import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MediaCapabilityId, MediaModelManifest } from '@spark/protocol'
import {
  MediaRouterService,
  type MediaProviderProfile,
} from '../../../services/media/media-router.service.js'

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function makeManifest(response: MediaModelManifest['invocation']['response']): MediaModelManifest {
  return {
    id: 'custom:v2-image:channel-instance',
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
        paramSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { n: { type: 'number', minimum: 1, maximum: 4 } },
        },
      },
    ],
    invocation: {
      mode: response.kind === 'task_poll' ? 'async_polling' : 'sync',
      endpoint: '/images',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {},
      request: {
        method: 'POST',
        endpoint: '/images',
        auth: { kind: 'bearer', credentialRef: 'apiKey' },
        body: {
          kind: 'json',
          template: {
            model: '{{modelId}}',
            prompt: '{{prompt}}',
            n: '{{providerParams.n}}',
          },
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

function makeProvider(manifest: MediaModelManifest): MediaProviderProfile {
  return {
    id: 'custom-v2-provider',
    name: 'Custom V2 provider',
    defaultModel: manifest.modelId,
    apiEndpoint: 'https://provider.example/v1',
    mediaProvider: 'custom',
    mediaCapabilities: manifest.capabilities.map(
      (capability) => capability.id,
    ) as MediaCapabilityId[],
    mediaModelManifests: [manifest],
    apiKey: 'secret-token',
    mediaDefaults: { polling: { intervalMs: 1 } },
  }
}

function makeInput(outputDir: string) {
  return {
    operation: 'text_to_image' as const,
    capability: 'image.generate' as const,
    prompt: 'a red fox',
    modelParams: { n: 2 },
    outputDir,
  }
}

describe('TemplateMediaAdapter V2 integration', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('routes a V2 custom manifest through the existing Provider router and preserves JSON types', async () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'spark-template-v2-'))
    tempDirs.push(outputDir)
    const manifest = makeManifest({ kind: 'inline_base64', jsonPaths: ['data[].b64_json'] })
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://provider.example/v1/images')
      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
      expect(JSON.parse(String(init?.body))).toEqual({
        model: 'v2-image',
        prompt: 'a red fox',
        n: 2,
      })
      return new Response(JSON.stringify({ data: [{ b64_json: PNG_PIXEL }] }), { status: 200 })
    })

    const result = await new MediaRouterService().invoke(makeInput(outputDir), {
      providers: [makeProvider(manifest)],
      providerProfileId: 'custom-v2-provider',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.providerProfileId).toBe('custom-v2-provider')
    expect(result.output.assets).toHaveLength(1)
    expect(readFileSync(result.output.assets[0]!.filePath!).length).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('supports V2 task polling with path task ids and inherited auth', async () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'spark-template-v2-poll-'))
    tempDirs.push(outputDir)
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
      if (url.endsWith('/images')) {
        expect(init?.method).toBe('POST')
        return new Response(JSON.stringify({ id: 'task/1' }), { status: 200 })
      }
      pollCount += 1
      expect(url).toBe('https://provider.example/v1/jobs/task%2F1')
      expect(init?.method).toBe('GET')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
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
      providers: [makeProvider(manifest)],
      providerProfileId: 'custom-v2-provider',
      fetch: fetchMock as unknown as typeof fetch,
    })

    expect(result.output.mode).toBe('async')
    expect(result.output.requestId).toBe('task/1')
    expect(result.output.assets).toHaveLength(1)
    expect(pollCount).toBe(2)
  })

  it('downloads a binary artifact through a post-poll request', async () => {
    const outputDir = mkdtempSync(path.join(os.tmpdir(), 'spark-template-v2-artifact-'))
    tempDirs.push(outputDir)
    const manifest = makeManifest({
      kind: 'task_poll',
      taskIdPaths: ['id'],
      statusPaths: ['status'],
      resultPaths: ['content_url'],
      poll: {
        method: 'GET',
        endpoint: '/videos/{taskId}',
        auth: { kind: 'inherit' },
        body: { kind: 'none' },
      },
      taskId: { location: 'path', name: 'taskId' },
      artifact: {
        request: {
          method: 'GET',
          endpoint: '/videos/{{taskId}}/content',
          auth: { kind: 'inherit' },
          body: { kind: 'none' },
        },
        response: { kind: 'binary_response' },
      },
    })
    manifest.id = 'custom:v2-video:channel-instance'
    manifest.modelId = 'v2-video'
    manifest.displayName = 'V2 video template'
    manifest.domains = ['video']
    manifest.capabilities = [
      {
        id: 'video.generate',
        label: 'Generate video',
        input: { required: ['prompt'] },
        output: { types: ['video'], mimeTypes: ['video/mp4'] },
        paramSchema: { type: 'object', additionalProperties: false, properties: {} },
      },
    ]

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/images')) {
        return new Response(JSON.stringify({ id: 'video/123' }), { status: 200 })
      }
      if (url.endsWith('/videos/video%2F123')) {
        expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
        return new Response(JSON.stringify({ id: 'video/123', status: 'succeeded' }), {
          status: 200,
        })
      }
      expect(url).toBe('https://provider.example/v1/videos/video%2F123/content')
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer secret-token')
      return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })
    })

    const result = await new MediaRouterService().invoke(
      {
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: 'a red fox running',
        modelParams: {},
        outputDir,
      },
      {
        providers: [makeProvider(manifest)],
        providerProfileId: 'custom-v2-provider',
        fetch: fetchMock as unknown as typeof fetch,
      },
    )

    expect(result.output.mode).toBe('async')
    expect(result.output.requestId).toBe('video/123')
    expect(result.output.assets).toHaveLength(1)
    const downloadedAsset = result.output.assets[0]
    expect(downloadedAsset?.filePath).toBeDefined()
    if (!downloadedAsset?.filePath) throw new Error('expected a downloaded artifact file')
    expect(readFileSync(downloadedAsset.filePath).length).toBe(8)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
