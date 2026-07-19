import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MediaProviderContext } from '../../../services/media/media-adapter.types.js'
import { XaiMediaAdapter } from '../../../services/media/adapters/xai-media.adapter.js'

const VIDEO_BYTES = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70])

function context(fetchImpl: typeof fetch, model = 'grok-imagine-video'): MediaProviderContext {
  return {
    apiKey: 'xai-test-key',
    apiEndpoint: 'https://api.x.ai/v1',
    defaultModel: model,
    mediaProvider: 'xai',
    mediaApiType: 'async',
    mediaDefaults: { polling: { intervalMs: 1, timeoutMs: 100 } },
    fetch: fetchImpl,
  }
}

function videoFetch(capture: { body?: Record<string, unknown> }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/videos/generations')) {
      capture.body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ request_id: 'request-1' }))
    }
    if (url.endsWith('/videos/request-1')) {
      return new Response(
        JSON.stringify({
          status: 'done',
          video: {
            url: 'https://temporary.x.ai/video.mp4',
            file_output: { file_id: 'file-video', public_url: 'https://cdn.x.ai/video.mp4' },
          },
        }),
      )
    }
    if (url === 'https://cdn.x.ai/video.mp4') return new Response(VIDEO_BYTES)
    return new Response(JSON.stringify({ error: { message: `Unexpected URL: ${url}` } }), {
      status: 404,
    })
  }) as typeof fetch
}

describe('XaiMediaAdapter official contract', () => {
  let outputDir: string
  const adapter = new XaiMediaAdapter()

  beforeEach(() => {
    outputDir = mkdtempSync(path.join(os.tmpdir(), 'xai-adapter-contract-'))
  })

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true })
  })

  it('sends only documented video generation fields and enables public URL storage', async () => {
    const capture: { body?: Record<string, unknown> } = {}
    const submissions: Array<{ requestId: string; response: unknown }> = []
    const ctx = context(videoFetch(capture))
    ctx.onTaskSubmitted = (submission) => submissions.push(submission)
    await adapter.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        outputDir,
        prompt: 'Animate this frame',
        inputFiles: [{ type: 'image', role: 'first_frame', url: 'https://input/frame.png' }],
        modelParams: {
          aspectRatio: '16:9',
          durationSeconds: 8,
          resolution: '720p',
          user: 'user-1',
          quality: 'hd',
          fps: 30,
          seed: 42,
          editStrength: 0.5,
          useLastFrame: true,
          filename: 'result.mp4',
        },
      },
      ctx,
    )

    expect(capture.body).toEqual({
      model: 'grok-imagine-video',
      prompt: 'Animate this frame',
      image: { url: 'https://input/frame.png' },
      duration: 8,
      aspect_ratio: '16:9',
      resolution: '720p',
      storage_options: { filename: 'result.mp4', public_url: true },
      user: 'user-1',
    })
    expect(submissions).toEqual([
      { requestId: 'request-1', response: { request_id: 'request-1' } },
    ])
  })

  it('uses the later duration alias when a stale default and the user selection coexist', async () => {
    const capture: { body?: Record<string, unknown> } = {}
    const ctx = context(videoFetch(capture))
    ctx.skipParameterValidation = true

    await adapter.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        outputDir,
        prompt: 'Animate this frame for three seconds',
        inputFiles: [{ type: 'image', role: 'first_frame', url: 'https://input/frame.png' }],
        modelParams: { durationSeconds: 8, duration: 3 },
      },
      ctx,
    )

    expect(capture.body?.duration).toBe(3)
  })

  it('forwards the provider duration alias when extending a video without validation', async () => {
    const capture: { body?: Record<string, unknown> } = {}
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/videos/extensions')) {
        capture.body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(JSON.stringify({ request_id: 'request-1' }))
      }
      return videoFetch(capture)(input, init)
    }) as typeof fetch
    const ctx = context(fetchImpl)
    ctx.skipParameterValidation = true

    await adapter.invoke(
      {
        operation: 'video_extend',
        capability: 'video.extend',
        outputDir,
        prompt: 'Continue this video',
        inputFiles: [{ type: 'video', role: 'input', url: 'https://input/video.mp4' }],
        modelParams: { duration: 3 },
      },
      ctx,
    )

    expect(capture.body?.duration).toBe(3)
  })

  it('maps all reference images without an undocumented local cap and rejects a last frame', async () => {
    const capture: { body?: Record<string, unknown> } = {}
    const references = Array.from({ length: 7 }, (_, index) => ({
      type: 'image' as const,
      role: 'reference' as const,
      url: `https://input/reference-${index + 1}.png`,
    }))
    await adapter.invoke(
      {
        operation: 'text_to_video',
        capability: 'video.reference_to_video',
        outputDir,
        prompt: 'Use these visual references',
        inputFiles: references,
        modelParams: { durationSeconds: 10 },
      },
      context(videoFetch(capture)),
    )
    expect(capture.body?.reference_images).toEqual(
      references.map((reference) => ({ url: reference.url })),
    )

    await expect(
      adapter.invoke(
        {
          operation: 'image_to_video',
          capability: 'video.image_to_video',
          outputDir,
          prompt: 'Use both frames',
          inputFiles: [
            { type: 'image', role: 'first_frame', url: 'https://input/first.png' },
            { type: 'image', role: 'last_frame', url: 'https://input/last.png' },
          ],
        },
        context(videoFetch({})),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('forwards user-confirmed xAI parameter warnings to the provider', async () => {
    const capture: { body?: Record<string, unknown> } = {}
    const ctx = context(videoFetch(capture))
    ctx.skipParameterValidation = true

    await adapter.invoke(
      {
        operation: 'text_to_video',
        capability: 'video.reference_to_video',
        outputDir,
        prompt: 'Let the provider decide',
        inputFiles: [
          { type: 'image', role: 'reference', url: 'https://input/reference.png' },
        ],
        modelParams: { durationSeconds: 11, resolution: '1080p' },
      },
      ctx,
    )

    expect(capture.body).toMatchObject({ duration: 11, resolution: '1080p' })
  })

  it('preserves the prompt reference numbering and reference_images order', async () => {
    const capture: { body?: Record<string, unknown> } = {}
    const prompt = [
      '[图片引用]',
      '参考图 #1：苏烬（角色）',
      '参考图 #2：出租屋（场景）',
      '[/图片引用]',
    ].join('\n')
    const references = [
      { type: 'image' as const, role: 'reference' as const, url: 'https://input/su-jin.png' },
      { type: 'image' as const, role: 'reference' as const, url: 'https://input/apartment.png' },
    ]

    await adapter.invoke(
      {
        operation: 'text_to_video',
        capability: 'video.reference_to_video',
        outputDir,
        prompt,
        inputFiles: references,
      },
      context(videoFetch(capture)),
    )

    expect(capture.body?.prompt).toBe(prompt)
    expect(capture.body?.reference_images).toEqual([
      { url: 'https://input/su-jin.png' },
      { url: 'https://input/apartment.png' },
    ])
  })

  it('uploads local inputs to xAI Files and sends REST file_id objects', async () => {
    const inputPath = path.join(outputDir, 'frame.png')
    writeFileSync(inputPath, Buffer.from('image-bytes'))
    const capture: { body?: Record<string, unknown>; multipartKeys?: string[]; uploadCount: number } = { uploadCount: 0 }
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/files')) {
        capture.uploadCount += 1
        capture.multipartKeys = [...(init?.body as FormData).keys()]
        return new Response(JSON.stringify({
          id: 'file-frame', filename: 'frame.png', bytes: 11, created_at: 1, object: 'file', purpose: 'user_data',
        }))
      }
      return videoFetch(capture)(input, init)
    }) as typeof fetch

    await adapter.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        outputDir,
        prompt: 'Animate the uploaded frame',
        inputFiles: [{ type: 'image', role: 'first_frame', path: inputPath, mimeType: 'image/png' }],
      },
      context(fetchImpl),
    )

    expect(capture.multipartKeys).toEqual(['file'])
    expect(capture.uploadCount).toBe(1)
    expect(capture.body?.image).toEqual({ file_id: 'file-frame' })
  })

  it('decodes canvas safe-file URLs before xAI Files upload', async () => {
    const inputPath = path.join(outputDir, 'safe-frame.png')
    writeFileSync(inputPath, Buffer.from('safe-image'))
    const encoded = Buffer.from(inputPath, 'utf8').toString('base64url')
    const capture: { body?: Record<string, unknown> } = {}
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/files')) {
        return new Response(JSON.stringify({
          id: 'file-safe', filename: 'safe-frame.png', bytes: 10, created_at: 1, object: 'file', purpose: 'user_data',
        }))
      }
      return videoFetch(capture)(input, init)
    }) as typeof fetch

    await adapter.invoke(
      {
        operation: 'image_to_video', capability: 'video.image_to_video', outputDir, prompt: 'Animate safe file',
        inputFiles: [{ type: 'image', role: 'first_frame', url: `safe-file://x/${encoded}`, mimeType: 'image/png' }],
      },
      context(fetchImpl),
    )
    expect(capture.body?.image).toEqual({ file_id: 'file-safe' })
  })

  it('falls back to a data URL for images when xAI Files upload fails', async () => {
    const inputPath = path.join(outputDir, 'frame.png')
    writeFileSync(inputPath, Buffer.from('image-bytes'))
    const capture: { body?: Record<string, unknown> } = {}
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/files')) {
        return new Response(JSON.stringify({ error: { message: 'files unavailable' } }), { status: 503 })
      }
      return videoFetch(capture)(input, init)
    }) as typeof fetch

    await adapter.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        outputDir,
        prompt: 'Animate with fallback',
        inputFiles: [{ type: 'image', role: 'first_frame', path: inputPath, mimeType: 'image/png' }],
      },
      context(fetchImpl),
    )

    expect(capture.body?.image).toEqual({
      url: `data:image/png;base64,${Buffer.from('image-bytes').toString('base64')}`,
    })
  })

  it('uses the official temporary video URL when public CDN persistence fails', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/videos/generations')) return new Response(JSON.stringify({ request_id: 'request-1' }))
      if (url.endsWith('/videos/request-1')) {
        return new Response(JSON.stringify({
          status: 'done',
          video: {
            url: 'https://temporary.x.ai/video.mp4',
            file_output: { file_id: 'file-video', public_url_error: 'creation timed out' },
          },
        }))
      }
      if (url === 'https://temporary.x.ai/video.mp4') return new Response(VIDEO_BYTES)
      return new Response('', { status: 404 })
    }) as typeof fetch

    const result = await adapter.invoke(
      { operation: 'text_to_video', capability: 'video.generate', outputDir, prompt: 'A test video' },
      context(fetchImpl),
    )

    expect(result.assets).toHaveLength(1)
    expect(result.assets[0]?.type).toBe('video')
  })

  it('resolves only the first-frame image for image-to-video', async () => {
    const firstPath = path.join(outputDir, 'first.png')
    const unusedPath = path.join(outputDir, 'unused.png')
    writeFileSync(firstPath, Buffer.from('first-image'))
    writeFileSync(unusedPath, Buffer.from('unused-image'))
    const capture: { body?: Record<string, unknown>; uploadCount: number } = { uploadCount: 0 }
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/files')) {
        capture.uploadCount += 1
        return new Response(JSON.stringify({
          id: `file-${capture.uploadCount}`, filename: 'frame.png', bytes: 11,
          created_at: 1, object: 'file', purpose: 'user_data',
        }))
      }
      return videoFetch(capture)(input, init)
    }) as typeof fetch

    await adapter.invoke(
      {
        operation: 'image_to_video', capability: 'video.image_to_video', outputDir,
        prompt: 'Animate only the first frame',
        inputFiles: [
          { type: 'image', role: 'first_frame', path: firstPath, mimeType: 'image/png' },
          { type: 'image', role: 'reference', path: unusedPath, mimeType: 'image/png' },
        ],
      },
      context(fetchImpl),
    )

    expect(capture.uploadCount).toBe(1)
    expect(capture.body?.image).toEqual({ file_id: 'file-1' })
  })

  it('enforces Grok Imagine Video 1.5 image-to-video only', async () => {
    await expect(
      adapter.invoke(
        {
          operation: 'text_to_video',
          capability: 'video.generate',
          outputDir,
          prompt: 'Text only',
        },
        context(videoFetch({}), 'grok-imagine-video-1.5'),
      ),
    ).rejects.toThrow('仅支持图生视频')
  })

  it('uses the official TTS endpoint and field names', async () => {
    let request: { url?: string; body?: Record<string, unknown> } = {}
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      request = {
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      }
      return new Response(Buffer.from('audio'))
    }) as typeof fetch

    await adapter.invoke(
      {
        operation: 'text_to_audio',
        capability: 'audio.speech',
        outputDir,
        prompt: '你好，世界',
        modelParams: {
          voiceId: 'Ara',
          language: 'zh-CN',
          outputFormat: { codec: 'wav', sample_rate: 24000, bit_rate: 128000 },
          speed: 1.2,
        },
      },
      context(fetchImpl, 'grok-tts'),
    )

    expect(request.url).toBe('https://api.x.ai/v1/tts')
    expect(request.body).toEqual({
      text: '你好，世界',
      voice_id: 'Ara',
      language: 'zh-CN',
      output_format: { codec: 'wav', sample_rate: 24000, bit_rate: 128000 },
      speed: 1.2,
    })
  })

  it('lets the provider decide how to handle TTS text above the local reference threshold', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(Buffer.from('audio'))
    }) as typeof fetch
    const text = '长'.repeat(15_001)

    await expect(
      adapter.invoke(
        {
          operation: 'text_to_audio',
          capability: 'audio.speech',
          outputDir,
          prompt: text,
        },
        context(fetchImpl, 'grok-tts'),
      ),
    ).resolves.toBeDefined()
    expect(body.text).toBe(text)
  })

  it('assembles flat canvas TTS fields into the official output_format object', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(Buffer.from('audio'))
    }) as typeof fetch

    await adapter.invoke(
      {
        operation: 'text_to_audio',
        capability: 'audio.speech',
        outputDir,
        prompt: 'flat fields',
        modelParams: { outputFormat: 'wav', sampleRate: 24_000, bitRate: 128_000 },
      },
      context(fetchImpl, 'grok-tts'),
    )

    expect(body.output_format).toEqual({ codec: 'wav', sample_rate: 24_000, bit_rate: 128_000 })
  })

  it('uses xAI TTS provider defaults when the task has no explicit overrides', async () => {
    let body: Record<string, unknown> = {}
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(Buffer.from('audio'))
    }) as typeof fetch
    const ctx = context(fetchImpl, 'grok-tts')
    ctx.mediaDefaults = {
      audio: { voice: 'Ara', format: 'wav', speed: 1.1 },
      polling: { intervalMs: 1, timeoutMs: 100 },
    }

    await adapter.invoke(
      {
        operation: 'text_to_audio',
        capability: 'audio.speech',
        outputDir,
        prompt: 'provider defaults',
      },
      ctx,
    )

    expect(body).toMatchObject({
      voice_id: 'Ara',
      output_format: { codec: 'wav' },
      speed: 1.1,
    })
  })

  it('uses storage_options and preserves each image public URL', async () => {
    let body: Record<string, unknown> | undefined
    const fetchImpl = (async (request: string | URL | Request, init?: RequestInit) => {
      if (String(request).startsWith('https://cdn.x.ai/')) return new Response(Buffer.from('image'))
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ data: [
        { url: 'https://temporary.x.ai/1.png', file_output: { file_id: 'file-1', public_url: 'https://cdn.x.ai/1.png' } },
        { url: 'https://temporary.x.ai/2.png', file_output: { file_id: 'file-2', public_url: 'https://cdn.x.ai/2.png' } },
      ] }))
    }) as typeof fetch

    const result = await adapter.invoke(
      {
        operation: 'text_to_image',
        capability: 'image.generate',
        outputDir,
        prompt: 'Two images',
        modelParams: { n: 2, aspectRatio: '16:9', resolution: '2k', responseFormat: 'url', filename: 'pair.png' },
      },
      context(fetchImpl, 'grok-imagine-image'),
    )

    expect(body).toEqual({
      model: 'grok-imagine-image',
      prompt: 'Two images',
      n: 2,
      aspect_ratio: '16:9',
      resolution: '2k',
      response_format: 'url',
      storage_options: { filename: 'pair.png', public_url: true },
    })
    expect(result.assets.map((asset) => asset.url)).toEqual([
      'https://cdn.x.ai/1.png',
      'https://cdn.x.ai/2.png',
    ])
  })
})
