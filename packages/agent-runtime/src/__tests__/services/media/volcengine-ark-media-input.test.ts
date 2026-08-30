import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaProviderContext } from '../../../services/media/media-adapter.types.js'
import { VolcengineArkMediaAdapter } from '../../../services/media/adapters/volcengine-ark-media.adapter.js'
import { resolveVolcengineMediaReference } from '../../../services/media/volcengine-ark-media-input.js'

describe('resolveVolcengineMediaReference', () => {
  let directory = ''

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'volc-input-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('uploads a readable local image through Ark Files first', async () => {
    const filePath = path.join(directory, 'frame.png')
    writeFileSync(filePath, Buffer.from('frame'))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ object: 'file', id: 'file-image', status: 'processing' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: 'file',
            id: 'file-image',
            filename: 'frame.png',
            status: 'active',
            download_url: 'https://signed.example.com/frame.png?signature=abc',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    await expect(
      resolveVolcengineMediaReference(
        { type: 'image', path: filePath, mimeType: 'image/png' },
        'image',
        context({ fetch: fetchMock }),
      ),
    ).resolves.toBe('https://signed.example.com/frame.png?signature=abc')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uploads a local reference video through Ark Files before public URL fallback', async () => {
    const filePath = path.join(directory, 'clip.mp4')
    writeFileSync(filePath, Buffer.from('video'))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ object: 'file', id: 'file-video', status: 'processing' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            object: 'file',
            id: 'file-video',
            status: 'active',
            download_url: 'https://signed.example.com/clip.mp4',
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
    const upload = vi.fn(async () => ({
      provider: 'volcengine-ark' as const,
      publicUrl: 'https://cdn.example.com/clip.mp4',
    }))

    await expect(
      resolveVolcengineMediaReference(
        { type: 'video', path: filePath, mimeType: 'video/mp4' },
        'video',
        context({
          fetch: fetchMock,
          fallbackUploader: {
            canHandle: (provider) => provider === 'volcengine-ark',
            upload,
          },
        }),
      ),
    ).resolves.toBe('https://signed.example.com/clip.mp4')
    expect(upload).not.toHaveBeenCalled()
  })

  it('falls back to the configured public uploader when Ark Files upload fails', async () => {
    const filePath = path.join(directory, 'fallback.mp4')
    writeFileSync(filePath, Buffer.from('video'))
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('Files unavailable'))
    const upload = vi.fn(async () => ({
      provider: 'volcengine-ark' as const,
      publicUrl: 'https://cdn.example.com/fallback.mp4',
    }))

    await expect(
      resolveVolcengineMediaReference(
        { type: 'video', path: filePath, mimeType: 'video/mp4' },
        'video',
        context({
          fetch: fetchMock,
          fallbackUploader: {
            canHandle: (provider) => provider === 'volcengine-ark',
            upload,
          },
        }),
      ),
    ).resolves.toBe('https://cdn.example.com/fallback.mp4')
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ targetProvider: 'volcengine-ark', mimeType: 'video/mp4' }),
    )
  })

  it('never forwards a renderer-only safe-file URL to Volcengine', async () => {
    await expect(
      resolveVolcengineMediaReference(
        { type: 'image', url: 'safe-file://x/not-materialized' },
        'image',
        context(),
      ),
    ).rejects.toThrow('可读取的本地文件')
  })

  it('converts a Volcengine Files file_id to its official signed URL', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'file',
          id: 'file-image',
          filename: 'frame.png',
          mime_type: 'image/png',
          status: 'active',
          download_url: 'https://signed.example.com/frame.png?signature=abc',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      resolveVolcengineMediaReference(
        { type: 'image', fileId: 'file-image' },
        'image',
        context({ fetch: fetchMock }),
      ),
    ).resolves.toBe('https://signed.example.com/frame.png?signature=abc')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses the official Files download URL for a reference video without local-path upload', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: 'file',
          id: 'file-video',
          filename: 'reference.mp4',
          mime_type: 'video/mp4',
          status: 'active',
          download_url: 'https://signed.example.com/reference.mp4?signature=abc',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      resolveVolcengineMediaReference(
        { type: 'video', fileId: 'file-video' },
        'video',
        context({ fetch: fetchMock }),
      ),
    ).resolves.toBe('https://signed.example.com/reference.mp4?signature=abc')
  })

  it('sends the resolved official URL to Seedance, never file_id or a local path', async () => {
    let requestBody = ''
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/files/file-image')) {
        return new Response(
          JSON.stringify({
            object: 'file',
            id: 'file-image',
            status: 'active',
            download_url: 'https://signed.example.com/frame.png?signature=abc',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.endsWith('/contents/generations/tasks')) {
        requestBody = String(init?.body ?? '')
        return new Response(
          JSON.stringify({ content: { video_url: 'https://cdn.example.com/result.mp4' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })
    }) as unknown as typeof fetch

    await new VolcengineArkMediaAdapter().invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: 'animate',
        inputFiles: [
          {
            type: 'image',
            role: 'first_frame',
            fileId: 'file-image',
            path: '/private/local/frame.png',
          },
        ],
        outputDir: directory,
      },
      context({ fetch: fetchMock }),
    )

    expect(requestBody).toContain('https://signed.example.com/frame.png?signature=abc')
    expect(requestBody).not.toContain('file-image')
    expect(requestBody).not.toContain('/private/local/frame.png')
  })

  it('falls back to an explicit URL when a stale Files file_id cannot be resolved', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 }),
      )

    await expect(
      resolveVolcengineMediaReference(
        { type: 'image', fileId: 'file-missing', url: 'https://cdn.example.com/fallback.png' },
        'image',
        context({ fetch: fetchMock }),
      ),
    ).resolves.toBe('https://cdn.example.com/fallback.png')
  })

  it('converts legacy canvas reference images to Seedance 1.x first and last frames', async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/contents/generations/tasks')) {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(
          JSON.stringify({ content: { video_url: 'https://cdn.example.com/result.mp4' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })
    }) as unknown as typeof fetch
    const adapter = new VolcengineArkMediaAdapter()

    await adapter.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: 'animate',
        inputFiles: [
          { type: 'image', role: 'reference', url: 'https://cdn.example.com/first.png' },
          { type: 'image', role: 'reference', url: 'https://cdn.example.com/last.png' },
        ],
        // Historical canvas snapshots could retain this obsolete custom field.
        // The native adapter must never forward it to Seedance 1.x.
        modelParams: { task_type: 'r2v' },
        outputDir: directory,
      },
      context({
        defaultModel: 'doubao-seedance-1-0-pro-250528',
        skipParameterValidation: true,
        fetch: fetchMock,
      }),
    )

    const content = requestBody?.content as Array<{ role?: string }>
    expect(content.filter((item) => item.role).map((item) => item.role)).toEqual([
      'first_frame',
      'last_frame',
    ])
    expect(JSON.stringify(requestBody)).not.toContain('reference_image')
    expect(requestBody).not.toHaveProperty('task_type')
  })

  it('submits Seedance 2 frames and multimodal references together when declared by the manifest', async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/contents/generations/tasks')) {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(
          JSON.stringify({ content: { video_url: 'https://cdn.example.com/result.mp4' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      })
    }) as unknown as typeof fetch
    const adapter = new VolcengineArkMediaAdapter()

    await adapter.invoke(
      {
        operation: 'image_to_video',
        capability: 'video.image_to_video',
        prompt: 'animate with references',
        inputFiles: [
          { type: 'image', role: 'first_frame', url: 'https://cdn.example.com/first.png' },
          { type: 'image', role: 'last_frame', url: 'https://cdn.example.com/last.png' },
          { type: 'image', role: 'reference', url: 'https://cdn.example.com/reference.png' },
          { type: 'video', role: 'reference', url: 'https://cdn.example.com/reference.mp4' },
          { type: 'audio', role: 'reference', url: 'https://cdn.example.com/reference.mp3' },
        ],
        outputDir: directory,
      },
      context({
        fetch: fetchMock,
        mediaManifestCapability: {
          id: 'video.image_to_video',
          label: '首尾帧 + 多模态参考',
          input: { required: ['image'], maxImages: 9, maxVideos: 3, maxAudios: 3 },
          rolePolicy: {
            imageRoles: ['first_frame', 'last_frame', 'reference_image'],
            videoRoles: ['reference_video'],
            audioRoles: ['reference_audio'],
            defaultRoleAssignment: 'first_then_last_then_reference',
          },
          output: { types: ['video'] },
          paramSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
      }),
    )

    const content = requestBody?.content as Array<{ role?: string }>
    expect(content.filter((item) => item.role).map((item) => item.role)).toEqual([
      'first_frame',
      'last_frame',
      'reference_image',
      'reference_video',
      'reference_audio',
    ])
  })

  it('submits Seedance 2.5 audio-only input with 30-second MOV output', async () => {
    let requestBody: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/contents/generations/tasks')) {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return new Response(
          JSON.stringify({ content: { video_url: 'https://cdn.example.com/result.mov' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'video/quicktime' },
      })
    }) as unknown as typeof fetch

    await new VolcengineArkMediaAdapter().invoke(
      {
        operation: 'image_to_video',
        capability: 'video.reference_to_video',
        prompt: '跟随音乐节奏变化',
        inputFiles: [{ type: 'audio', role: 'reference', url: 'https://cdn.example.com/beat.mp3' }],
        modelParams: { durationSeconds: 30, outputFormat: 'mov' },
        outputDir: directory,
      },
      context({
        defaultModel: 'doubao-seedance-2-5-260628',
        skipParameterValidation: true,
        fetch: fetchMock,
        mediaManifestCapability: {
          id: 'video.reference_to_video',
          label: 'Seedance 2.5 多模态参考',
          input: { required: [], maxImages: 30, maxVideos: 10, maxAudios: 10 },
          rolePolicy: {
            imageRoles: ['reference_image'],
            videoRoles: ['reference_video'],
            audioRoles: ['reference_audio'],
            defaultRoleAssignment: 'all_reference',
          },
          output: { types: ['video'], mimeTypes: ['video/mp4', 'video/quicktime'] },
          paramSchema: {
            type: 'object',
            properties: { outputFormat: { enum: ['mp4', 'mov'] } },
            additionalProperties: false,
          },
          aliases: { durationSeconds: 'duration', outputFormat: 'output_format' },
        },
      }),
    )

    expect(requestBody).toMatchObject({ duration: 30, output_format: 'mov' })
    expect(requestBody?.content).toEqual([
      { type: 'text', text: '跟随音乐节奏变化' },
      {
        type: 'audio_url',
        audio_url: { url: 'https://cdn.example.com/beat.mp3' },
        role: 'reference_audio',
      },
    ])
  })
})

function context(overrides: Partial<MediaProviderContext> = {}): MediaProviderContext {
  return {
    apiKey: 'test',
    apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seedance-2-0-260128',
    mediaProvider: 'volcengine-ark',
    mediaApiType: 'async',
    ...overrides,
  }
}
