import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { MediaProviderContext } from '../../../services/media/media-adapter.types.js'
import { GoogleGenerativeAiMediaAdapter } from '../../../services/media/adapters/google-generative-ai-media.adapter.js'
import { OpenAiOfficialMediaAdapter } from '../../../services/media/adapters/openai-official-media.adapter.js'

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII='
const outputDir = mkdtempSync(join(tmpdir(), 'spark-official-media-'))

afterAll(() => rmSync(outputDir, { recursive: true, force: true }))

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function context(
  provider: 'openai-images' | 'google-generative-ai',
  model: string,
  fetchImpl: typeof fetch,
): MediaProviderContext {
  return {
    apiKey: 'test-key',
    apiEndpoint:
      provider === 'openai-images'
        ? 'https://api.openai.test/v1'
        : 'https://generativelanguage.googleapis.test/v1beta',
    defaultModel: model,
    mediaProvider: provider,
    mediaApiType: 'auto',
    mediaDefaults: { polling: { intervalMs: 1, timeoutMs: 1000 } },
    fetch: fetchImpl,
  }
}

describe('OpenAI official media adapter', () => {
  const adapter = new OpenAiOfficialMediaAdapter()

  it('uses synchronous image generation by default', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({ data: [{ b64_json: PNG_PIXEL }] })
    }
    const output = await adapter.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: 'a quiet observatory',
        outputDir,
        modelParams: { quality: 'high', outputFormat: 'png' },
      },
      context('openai-images', 'gpt-image-2', fetchImpl),
    )

    expect(body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'a quiet observatory',
      quality: 'high',
      output_format: 'png',
    })
    expect(body).not.toHaveProperty('stream')
    expect(output.mode).toBe('sync')
    expect(existsSync(output.assets[0]?.filePath ?? '')).toBe(true)
  })

  it('sends image edits as multipart with repeated image fields', async () => {
    let contentType = ''
    let multipart = ''
    const fetchImpl: typeof fetch = async (_url, init) => {
      contentType = String(new Headers(init?.headers).get('content-type'))
      multipart = Buffer.from(init?.body as Uint8Array).toString('latin1')
      return jsonResponse({ data: [{ b64_json: PNG_PIXEL }] })
    }
    const output = await adapter.invoke(
      {
        operation: 'image_edit',
        capability: 'image.edit',
        prompt: 'make it blue',
        outputDir,
        inputFiles: [
          { type: 'image', dataUrl: `data:image/png;base64,${PNG_PIXEL}` },
          { type: 'image', dataUrl: `data:image/png;base64,${PNG_PIXEL}`, role: 'reference' },
        ],
        modelParams: { inputFidelity: 'low' },
      },
      context('openai-images', 'gpt-image-2', fetchImpl),
    )

    expect(contentType).toContain('multipart/form-data; boundary=')
    expect(multipart.match(/name="image\[\]"/g)).toHaveLength(2)
    expect(multipart).toContain('name="prompt"')
    expect(multipart).not.toContain('name="input_fidelity"')
    expect(output.assets).toHaveLength(1)
  })

  it('polls Sora and downloads the content endpoint', async () => {
    const urls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/videos')) return jsonResponse({ id: 'video_123', status: 'queued' })
      if (url.endsWith('/videos/video_123'))
        return jsonResponse({ id: 'video_123', status: 'completed' })
      if (url.endsWith('/videos/video_123/content')) {
        return new Response(Buffer.from('video-bytes'), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        })
      }
      return new Response('not found', { status: 404 })
    }
    const output = await adapter.invoke(
      {
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: 'a paper boat on a river',
        outputDir,
        modelParams: { seconds: '8', size: '1280x720' },
      },
      context('openai-images', 'sora-2', fetchImpl),
    )

    expect(urls).toContain('https://api.openai.test/v1/videos/video_123/content')
    expect(output.mode).toBe('async')
    expect(output.requestId).toBe('video_123')
    expect(existsSync(output.assets[0]?.filePath ?? '')).toBe(true)
  })
})

describe('Google official media adapter', () => {
  const adapter = new GoogleGenerativeAiMediaAdapter()

  it('calls Imagen predict and extracts imageBytes', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({ generatedImages: [{ image: { imageBytes: PNG_PIXEL } }] })
    }
    const output = await adapter.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        prompt: 'an editorial still life',
        outputDir,
        modelParams: { numberOfImages: 2, imageSize: '2K', aspectRatio: '16:9' },
      },
      context('google-generative-ai', 'imagen-4.0-generate-001', fetchImpl),
    )

    expect(body).toEqual({
      instances: [{ prompt: 'an editorial still life' }],
      parameters: {
        sampleCount: 2,
        imageSize: '2K',
        aspectRatio: '16:9',
        personGeneration: 'allow_adult',
      },
    })
    expect(output.assets[0]?.type).toBe('image')
  })

  it('keeps Veo reference images separate from first-frame input', async () => {
    let submittedBody: Record<string, unknown> = {}
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith(':predictLongRunning')) {
        submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return jsonResponse({ name: 'operations/veo-reference' })
      }
      if (url.endsWith('/operations/veo-reference')) {
        return jsonResponse({
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                {
                  video: {
                    data: Buffer.from('veo-video').toString('base64'),
                    mimeType: 'video/mp4',
                  },
                },
              ],
            },
          },
        })
      }
      return new Response('not found', { status: 404 })
    }

    const output = await adapter.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.reference_to_video',
        prompt: 'keep both products visually consistent',
        outputDir,
        inputFiles: [
          { type: 'image', role: 'reference', dataUrl: `data:image/png;base64,${PNG_PIXEL}` },
          { type: 'image', role: 'reference', dataUrl: `data:image/png;base64,${PNG_PIXEL}` },
        ],
      },
      context('google-generative-ai', 'veo-3.1-generate-preview', fetchImpl),
    )

    const instance = (submittedBody.instances as Array<Record<string, unknown>>)[0]
    if (!instance) throw new Error('Expected a Veo request instance')
    expect(instance).not.toHaveProperty('image')
    expect(instance.referenceImages).toHaveLength(2)
    expect(output.assets[0]?.type).toBe('video')
  })

  it('preserves separate first and last frames for Veo image-to-video', async () => {
    let submittedBody: Record<string, unknown> = {}
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith(':predictLongRunning')) {
        submittedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return jsonResponse({ name: 'operations/veo-frames' })
      }
      if (url.endsWith('/operations/veo-frames')) {
        return jsonResponse({
          done: true,
          response: {
            generateVideoResponse: {
              generatedSamples: [
                {
                  video: {
                    data: Buffer.from('veo-video').toString('base64'),
                    mimeType: 'video/mp4',
                  },
                },
              ],
            },
          },
        })
      }
      return new Response('not found', { status: 404 })
    }

    await adapter.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: 'transition smoothly between frames',
        outputDir,
        inputFiles: [
          { type: 'image', role: 'first_frame', dataUrl: `data:image/png;base64,${PNG_PIXEL}` },
          { type: 'image', role: 'last_frame', dataUrl: `data:image/png;base64,${PNG_PIXEL}` },
        ],
      },
      context('google-generative-ai', 'veo-3.1-generate-preview', fetchImpl),
    )

    const instance = (submittedBody.instances as Array<Record<string, unknown>>)[0]
    if (!instance) throw new Error('Expected a Veo request instance')
    expect(instance).toHaveProperty('image.inlineData')
    expect(instance).toHaveProperty('lastFrame.inlineData')
    expect(instance).not.toHaveProperty('referenceImages')
  })

  it('calls Omni through Interactions and materializes inline video', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl: typeof fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return jsonResponse({
        id: 'interaction_1',
        status: 'completed',
        output_video: {
          data: Buffer.from('omni-video').toString('base64'),
          mime_type: 'video/mp4',
        },
      })
    }
    const output = await adapter.invoke(
      {
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: 'a glass sculpture rotating',
        outputDir,
      },
      context('google-generative-ai', 'gemini-omni-flash-preview', fetchImpl),
    )

    expect(body).toMatchObject({
      model: 'gemini-omni-flash-preview',
      background: true,
      response_format: { type: 'video', aspect_ratio: '16:9', delivery: 'base64' },
      generation_config: { video_config: { task: 'text_to_video', duration_seconds: 6 } },
    })
    expect(output.assets[0]?.type).toBe('video')
  })

  it('waits for Omni URI files to become active before downloading', async () => {
    const urls: string[] = []
    let filePollCount = 0
    let downloadApiKey = ''
    const downloadUri =
      'https://generativelanguage.googleapis.test/v1beta/files/omni-file:download?alt=media'
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/interactions')) {
        return jsonResponse({
          id: 'interaction_uri',
          status: 'completed',
          input: [{ type: 'image', uri: 'https://input.example/reference.png' }],
          steps: [
            {
              type: 'model_output',
              content: [{ type: 'video', mime_type: 'video/mp4', uri: downloadUri }],
            },
          ],
        })
      }
      if (url.endsWith('/files/omni-file')) {
        filePollCount += 1
        return jsonResponse({ state: filePollCount === 1 ? 'PROCESSING' : 'ACTIVE' })
      }
      if (url === downloadUri) {
        downloadApiKey = String(new Headers(init?.headers).get('x-goog-api-key') ?? '')
        return new Response(Buffer.from('omni-uri-video'), {
          status: 200,
          headers: { 'content-type': 'video/mp4' },
        })
      }
      return new Response('not found', { status: 404 })
    }

    const output = await adapter.invoke(
      {
        operation: 'text_to_video',
        capability: 'video.generate',
        prompt: 'a silver kite over the ocean',
        outputDir,
        modelParams: { delivery: 'uri' },
      },
      context('google-generative-ai', 'gemini-omni-flash-preview', fetchImpl),
    )

    expect(filePollCount).toBe(2)
    expect(urls.at(-1)).toBe(downloadUri)
    expect(urls).not.toContain('https://input.example/reference.png')
    expect(downloadApiKey).toBe('test-key')
    expect(output.assets[0]?.type).toBe('video')
  })

  it('calls Lyria through Interactions and materializes output_audio', async () => {
    let apiKeyHeader = ''
    const fetchImpl: typeof fetch = async (_url, init) => {
      apiKeyHeader = String(new Headers(init?.headers).get('x-goog-api-key'))
      return jsonResponse({
        output_audio: { data: Buffer.from('music').toString('base64'), mime_type: 'audio/mpeg' },
      })
    }
    const output = await adapter.invoke(
      {
        operation: 'text_to_audio',
        capability: 'audio.music',
        prompt: '[Verse] a bright synth-pop hook',
        outputDir,
      },
      context('google-generative-ai', 'lyria-3-pro-preview', fetchImpl),
    )

    expect(apiKeyHeader).toBe('test-key')
    expect(output.assets[0]?.type).toBe('audio')
    expect(existsSync(output.assets[0]?.filePath ?? '')).toBe(true)
  })
})
