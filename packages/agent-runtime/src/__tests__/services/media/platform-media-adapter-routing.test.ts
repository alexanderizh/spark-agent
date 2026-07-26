import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'
import {
  MediaRouterService,
  invocationProviderKind,
  type MediaProviderProfile,
} from '../../../services/media/media-router.service.js'

const outputDirs: string[] = []

afterEach(() => {
  for (const outputDir of outputDirs.splice(0)) {
    rmSync(outputDir, { recursive: true, force: true })
  }
})

describe('platform media adapter routing', () => {
  it('uses the mapped manifest adapter only for the managed NewAPI profile', () => {
    const managed = {
      mediaProvider: null,
      managedType: 'newapi',
    } as Pick<MediaProviderProfile, 'mediaProvider' | 'managedType'>

    expect(invocationProviderKind(managed, { providerKind: 'openai-images' })).toBe(
      'openai-images',
    )
    expect(invocationProviderKind(managed, { providerKind: 'volcengine-ark' })).toBe(
      'volcengine-ark',
    )
  })

  it('keeps existing provider-level adapter routing unchanged', () => {
    const ordinary = {
      mediaProvider: 'volcengine-ark',
    } as Pick<MediaProviderProfile, 'mediaProvider' | 'managedType'>

    expect(invocationProviderKind(ordinary, { providerKind: 'openai-images' })).toBe(
      'volcengine-ark',
    )
  })

  it('uses template behavior while sending the platform alias from Canvas', async () => {
    const source = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'openai-images:gpt-image-2',
    )
    if (!source) throw new Error('missing OpenAI image template')
    const manifest = {
      ...source,
      id: 'platform:spark-img:test',
      modelId: 'spark-img',
      adapterModelId: source.modelId,
      displayName: 'Spark Image',
    }
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII='
    let requestUrl = ''
    let requestBody = ''
    const fetchImpl: typeof fetch = async (input, init) => {
      requestUrl = String(input)
      requestBody = Buffer.from(init?.body as Uint8Array).toString('utf8')
      return new Response(JSON.stringify({ data: [{ b64_json: pngBase64 }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const outputDir = mkdtempSync(path.join(tmpdir(), 'spark-platform-canvas-'))
    outputDirs.push(outputDir)

    const result = await new MediaRouterService().invoke(
      {
        operation: 'image_edit',
        prompt: 'edit this image',
        inputFiles: [{
          type: 'image',
          dataUrl: `data:image/png;base64,${pngBase64}`,
        }],
        modelParams: { inputFidelity: 'high' },
        outputDir,
      },
      {
        providers: [{
          id: 'spark-platform-newapi',
          name: 'Spark Platform',
          defaultModel: 'spark-img',
          apiEndpoint: 'https://newapi.example/v1',
          mediaProvider: null,
          mediaApiType: 'sync',
          mediaModelManifests: [manifest],
          apiKey: 'sk-platform',
          managedType: 'newapi',
        }],
        providerProfileId: 'spark-platform-newapi',
        modelId: 'spark-img',
        capability: 'image.edit',
        fetch: fetchImpl,
      },
    )

    expect(requestUrl).toBe('https://newapi.example/v1/images/edits')
    expect(requestBody).toContain('name="model"\r\n\r\nspark-img')
    expect(requestBody).not.toContain('input_fidelity')
    expect(result.output.model).toBe('spark-img')
    expect(result.output.assets).toHaveLength(1)
  })
})
