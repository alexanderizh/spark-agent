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

  it('materializes a readable local image as an official data URL', async () => {
    const filePath = path.join(directory, 'frame.png')
    writeFileSync(filePath, Buffer.from('frame'))

    await expect(
      resolveVolcengineMediaReference(
        { type: 'image', path: filePath, mimeType: 'image/png' },
        'image',
        context(),
      ),
    ).resolves.toBe(`data:image/png;base64,${Buffer.from('frame').toString('base64')}`)
  })

  it('uploads a local reference video and uses its public HTTPS URL', async () => {
    const filePath = path.join(directory, 'clip.mp4')
    writeFileSync(filePath, Buffer.from('video'))
    const upload = vi.fn(async () => ({
      provider: 'volcengine-ark' as const,
      publicUrl: 'https://cdn.example.com/clip.mp4',
    }))

    await expect(
      resolveVolcengineMediaReference(
        { type: 'video', path: filePath, mimeType: 'video/mp4' },
        'video',
        context({
          fallbackUploader: {
            canHandle: (provider) => provider === 'volcengine-ark',
            upload,
          },
        }),
      ),
    ).resolves.toBe('https://cdn.example.com/clip.mp4')
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
