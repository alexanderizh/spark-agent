import { describe, expect, it } from 'vitest'
import { collectCanvasVideoWorkbenchPaths } from './canvasVideoWorkbenchPaths.js'

describe('collectCanvasVideoWorkbenchPaths', () => {
  it('keeps keyframe and output files referenced by a persisted workbench', () => {
    const paths = collectCanvasVideoWorkbenchPaths({
      keyframes: [
        {
          path: 'C:/user-data/.spark-artifacts/media/video-workbench/frame.jpg',
          previewUrl: 'safe-file://frame-preview',
        },
      ],
      outputs: [
        {
          outputPath: 'C:/user-data/.spark-artifacts/media/video-workbench/cut.mp4',
          outputUrl: 'safe-file://cut-preview',
        },
      ],
    })

    expect(paths).toEqual([
      'C:/user-data/.spark-artifacts/media/video-workbench/frame.jpg',
      'safe-file://frame-preview',
      'C:/user-data/.spark-artifacts/media/video-workbench/cut.mp4',
      'safe-file://cut-preview',
    ])
  })

  it('ignores malformed or unrelated workbench fields', () => {
    expect(
      collectCanvasVideoWorkbenchPaths({
        keyframes: [{ path: '', previewUrl: 42 }],
        outputs: [{ outputPath: null, outputUrl: undefined }],
        summary: 'not a file path',
      }),
    ).toEqual([])
  })
})
