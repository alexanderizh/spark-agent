import { describe, expect, it, vi } from 'vitest'
import {
  getMessageImagePreview,
  preparedMessageImageRenderState,
} from './message-image-preview'

const resolveSrc = (path: string) => `resolved:${path}`

describe('message image preview', () => {
  it('uses the immediate preview URL without preparing another preview', () => {
    expect(
      getMessageImagePreview(
        {
          type: 'image',
          path: '/tmp/optimized.jpg',
          previewPath: '/tmp/original.png',
          previewUrl: 'spark-safe-file://x/original',
        },
        resolveSrc,
      ),
    ).toEqual({
      initialSrc: 'spark-safe-file://x/original',
      sourcePath: '/tmp/original.png',
      needsPreparedPreview: false,
    })
  })

  it('prefers the preview path over the optimized send path', () => {
    expect(
      getMessageImagePreview(
        {
          type: 'image',
          path: '/tmp/optimized.jpg',
          previewPath: '/tmp/original.png',
        },
        resolveSrc,
      ),
    ).toEqual({
      initialSrc: null,
      sourcePath: '/tmp/original.png',
      needsPreparedPreview: true,
    })
  })

  it('keeps the existing prepared-preview behavior for a normal local path', () => {
    expect(
      getMessageImagePreview({ type: 'image', path: '/tmp/image.png' }, resolveSrc),
    ).toEqual({
      initialSrc: null,
      sourcePath: '/tmp/image.png',
      needsPreparedPreview: true,
    })
  })

  it('does not synthesize a safe-file request for an arbitrary local path', () => {
    const resolveLocalSrc = vi.fn((path: string) => `safe-file://encoded/${path}`)

    expect(
      getMessageImagePreview(
        { type: 'image', path: '/Users/test/Pictures/outside-allowlist.jpg' },
        resolveLocalSrc,
      ),
    ).toEqual({
      initialSrc: null,
      sourcePath: '/Users/test/Pictures/outside-allowlist.jpg',
      needsPreparedPreview: true,
    })
    expect(resolveLocalSrc).not.toHaveBeenCalled()
  })

  it('clears a previous image error when a prepared preview becomes available', () => {
    expect(preparedMessageImageRenderState('safe-file://x/copied-preview')).toEqual({
      resolvedSrc: 'safe-file://x/copied-preview',
      imgError: false,
    })
  })

  it('does not prepare remote, data, blob or safe-file URLs', () => {
    for (const path of [
      'https://example.com/image.png',
      'data:image/png;base64,AA==',
      'blob:https://example.com/id',
      'safe-file://x/image',
      'spark-safe-file://x/image',
    ]) {
      expect(getMessageImagePreview({ type: 'image', path }, resolveSrc).needsPreparedPreview).toBe(
        false,
      )
    }
  })
})
