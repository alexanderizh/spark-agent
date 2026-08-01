import { describe, expect, it } from 'vitest'
import { getMessageImagePreview } from './message-image-preview'

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
      initialSrc: 'resolved:/tmp/original.png',
      sourcePath: '/tmp/original.png',
      needsPreparedPreview: true,
    })
  })

  it('keeps the existing prepared-preview behavior for a normal local path', () => {
    expect(
      getMessageImagePreview({ type: 'image', path: '/tmp/image.png' }, resolveSrc),
    ).toEqual({
      initialSrc: 'resolved:/tmp/image.png',
      sourcePath: '/tmp/image.png',
      needsPreparedPreview: true,
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
