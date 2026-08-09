import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'
import { MediaRouterService } from '../../../services/media/media-router.service.js'
import type { MediaProviderProfile } from '../../../services/media/media-router.service.js'

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function makeProvider(overrides: Partial<MediaProviderProfile> = {}): MediaProviderProfile {
  return {
    id: 'bailian-image',
    name: 'Bailian',
    defaultModel: 'wan2.7-image-pro',
    apiEndpoint: 'https://workspace.cn-beijing.maas.aliyuncs.com',
    mediaProvider: 'bailian',
    mediaApiType: 'sync',
    mediaCapabilities: ['image.generate', 'image.edit'],
    apiKey: 'sk-test',
    ...overrides,
  }
}

describe('BailianMediaAdapter — custom image size', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `spark-bailian-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('accepts and normalizes a custom width*height size for Wan 2.7', async () => {
    let submitted: Record<string, unknown> | undefined
    const fetchMock = (async (_input: string | URL | Request, init?: RequestInit) => {
      submitted = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(
        JSON.stringify({
          request_id: 'custom-size-request',
          output: {
            choices: [
              {
                message: {
                  content: [{ type: 'image', image: `data:image/png;base64,${PNG_PIXEL}` }],
                },
              },
            ],
          },
        }),
        { status: 200 },
      )
    }) as typeof fetch
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:wan2.7-image-pro',
    )!

    const result = await new MediaRouterService().invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: 'a flower shop',
        outputDir: tmpDir,
        modelParams: { size: '2048 * 1152', n: 1 },
      },
      {
        providers: [
          makeProvider({ defaultModel: manifest.modelId, mediaModelManifests: [manifest] }),
        ],
        modelId: manifest.modelId,
        fetch: fetchMock,
      },
    )

    expect(result.output.assets).toHaveLength(1)
    expect(readFileSync(result.output.assets[0]!.filePath!)).toEqual(
      Buffer.from(PNG_PIXEL, 'base64'),
    )
    expect(submitted).toMatchObject({
      parameters: { size: '2048*1152', n: 1 },
    })
  })

  it('rejects custom sizes outside the documented pixel and aspect-ratio limits', async () => {
    const fetchMock = (async () => {
      throw new Error('fetch should not be called')
    }) as typeof fetch
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:wan2.7-image',
    )!

    await expect(
      new MediaRouterService().invoke(
        {
          operation: 'text_to_image',
          capability: 'image.generate',
          prompt: 'a flower shop',
          outputDir: tmpDir,
          modelParams: { size: '4096*256', n: 1 },
        },
        {
          providers: [
            makeProvider({ defaultModel: manifest.modelId, mediaModelManifests: [manifest] }),
          ],
          modelId: manifest.modelId,
          fetch: fetchMock,
        },
      ),
    ).rejects.toThrow('自定义尺寸')
  })
})
