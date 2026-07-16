import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaProviderContext } from '../../../services/media/media-adapter.types.js'
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
