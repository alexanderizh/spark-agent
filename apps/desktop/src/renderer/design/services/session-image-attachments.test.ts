import { describe, expect, it, vi } from 'vitest'
import type { ComposerAttachmentDraft } from './composer-attachments'
import {
  formatSessionImageOptimizationNotice,
  prepareSessionImageAttachments,
} from './session-image-attachments'

const attachments: ComposerAttachmentDraft[] = [
  {
    id: 'image',
    type: 'image',
    path: '/images/source.png',
    name: 'source.png',
    previewPath: '/previews/source.png',
    previewUrl: 'safe-file://preview',
  },
  { id: 'file', type: 'file', path: '/files/notes.md', name: 'notes.md' },
]

describe('prepareSessionImageAttachments', () => {
  it('replaces only optimized image paths and preserves preview fields', async () => {
    const result = await prepareSessionImageAttachments(attachments, async () => ({
      results: [
        {
          sourcePath: '/images/source.png',
          outputPath: '/optimized/source.png',
          status: 'optimized',
          inputBytes: 8_000_000,
          outputBytes: 2_000_000,
          durationMs: 500,
        },
      ],
    }))

    expect(result.attachments).toEqual([
      { ...attachments[0], path: '/optimized/source.png' },
      attachments[1],
    ])
    expect(result.summary).toEqual({
      optimizedCount: 1,
      fallbackCount: 0,
      inputBytes: 8_000_000,
      outputBytes: 2_000_000,
    })
  })

  it('keeps original and fallback image paths unchanged', async () => {
    const result = await prepareSessionImageAttachments(attachments, async () => ({
      results: [
        {
          sourcePath: '/images/source.png',
          outputPath: '/images/source.png',
          status: 'fallback',
          reason: 'timeout',
          inputBytes: 8_000_000,
          outputBytes: 8_000_000,
          durationMs: 3_000,
        },
      ],
    }))

    expect(result.attachments).toEqual(attachments)
    expect(result.summary.fallbackCount).toBe(1)
    expect(result.summary.optimizedCount).toBe(0)
  })

  it('returns original attachments when the IPC call rejects', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('ipc unavailable')
    })

    const result = await prepareSessionImageAttachments(attachments, invoke)

    expect(result.attachments).toEqual(attachments)
    expect(result.summary).toEqual({
      optimizedCount: 0,
      fallbackCount: 1,
      inputBytes: 0,
      outputBytes: 0,
    })
  })

  it('does not invoke IPC when there are no images', async () => {
    const invoke = vi.fn()
    const fileAttachment = attachments[1]
    if (fileAttachment == null) throw new Error('missing file fixture')

    const result = await prepareSessionImageAttachments([fileAttachment], invoke)

    expect(invoke).not.toHaveBeenCalled()
    expect(result.attachments).toEqual([fileAttachment])
  })

  it('formats one aggregate notice for optimized and fallback images', () => {
    expect(
      formatSessionImageOptimizationNotice({
        optimizedCount: 2,
        fallbackCount: 1,
        inputBytes: 10 * 1024 * 1024,
        outputBytes: 3 * 1024 * 1024,
      }),
    ).toEqual({
      level: 'warning',
      message: '已优化 2 张图片：10.0 MB → 3.0 MB；1 张优化失败，已使用原图发送',
    })
  })
})
