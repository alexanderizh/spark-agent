import { describe, expect, it } from 'vitest'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import {
  isPromptTextNode,
  readPromptLibraryCover,
  readPromptLibraryText,
} from './canvasPromptLibraryData'

function asset(
  id: string,
  type: CanvasAsset['type'],
  overrides: Partial<CanvasAsset> = {},
): CanvasAsset {
  return {
    id,
    projectId: 'project-1',
    userId: 1,
    type,
    source: 'manual',
    title: id,
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function node(type: CanvasNode['type']): Pick<CanvasNode, 'type'> {
  return { type }
}

describe('canvas prompt library data', () => {
  it('uses contentText first and falls back to metadata.prompt', () => {
    expect(
      readPromptLibraryText(
        asset('prompt-1', 'prompt', {
          contentText: '  正文  ',
          metadata: { prompt: '旧字段' },
        }),
      ),
    ).toBe('正文')
    expect(
      readPromptLibraryText(asset('prompt-2', 'prompt', { metadata: { prompt: '  旧字段  ' } })),
    ).toBe('旧字段')
    expect(readPromptLibraryText(asset('prompt-3', 'prompt'))).toBe('')
  })

  it('accepts a cover only when its linked asset or MIME type proves it is an image', () => {
    const image = asset('image-1', 'image', { url: 'safe-file://project/image.png' })
    const video = asset('video-1', 'video', { url: 'safe-file://project/video.mp4' })
    expect(
      readPromptLibraryCover(
        asset('prompt-image', 'prompt', {
          metadata: { attributes: { coverAssetId: image.id } },
        }),
        [image],
      ),
    ).toEqual({ assetId: image.id, url: image.url, mimeType: null })
    expect(
      readPromptLibraryCover(
        asset('prompt-video', 'prompt', {
          metadata: { attributes: { coverAssetId: video.id, coverUrl: video.url } },
        }),
        [video],
      ),
    ).toEqual({ assetId: null, url: null, mimeType: null })
    expect(
      readPromptLibraryCover(
        asset('prompt-upload', 'prompt', {
          metadata: { attributes: { coverUrl: 'safe-file://project/cover.png' } },
        }),
        [],
      ),
    ).toEqual({ assetId: null, url: null, mimeType: null })
    expect(
      readPromptLibraryCover(
        asset('prompt-upload-image', 'prompt', {
          metadata: {
            attributes: {
              coverUrl: 'safe-file://project/cover.png',
              coverMimeType: 'image/png',
            },
          },
        }),
        [],
      ),
    ).toEqual({ assetId: null, url: 'safe-file://project/cover.png', mimeType: 'image/png' })
  })

  it('only treats text and prompt nodes as text sources', () => {
    expect(isPromptTextNode(node('text'))).toBe(true)
    expect(isPromptTextNode(node('prompt'))).toBe(true)
    expect(isPromptTextNode(node('image'))).toBe(false)
    expect(isPromptTextNode(node('text_to_image'))).toBe(false)
  })
})
