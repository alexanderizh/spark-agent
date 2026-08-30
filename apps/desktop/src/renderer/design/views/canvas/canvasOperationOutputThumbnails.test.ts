import { describe, expect, it } from 'vitest'
import { buildCanvasOperationMediaThumbnailItems } from './canvasOperationOutputThumbnails'
import type { CanvasOperationOutputView, CanvasOperationRunView } from './canvasOperationRuns'

const at = '2026-08-01T00:00:00.000Z'

function output(
  id: string,
  type: CanvasOperationOutputView['type'],
  media: Pick<CanvasOperationOutputView, 'url' | 'thumbnailUrl'> = {},
): CanvasOperationOutputView {
  return {
    id,
    type,
    title: id,
    ...media,
    createdAt: at,
    updatedAt: at,
  }
}

function run(taskId: string, outputs: CanvasOperationOutputView[]): CanvasOperationRunView {
  return {
    taskId,
    status: 'completed',
    progress: 100,
    createdAt: at,
    outputs,
  }
}

describe('buildCanvasOperationMediaThumbnailItems', () => {
  it('按运行与产物原顺序聚合全部历史图片和视频产物', () => {
    const imageNew = output('image-new', 'image', { url: 'new.png' })
    const videoNew = output('video-new', 'video', { url: 'video.mp4' })
    const imageOld = output('image-old', 'image', {
      url: 'old.png',
      thumbnailUrl: 'old-thumb.png',
    })
    const runs = [
      run('new', [output('notes', 'text'), imageNew, videoNew]),
      run('old', [imageOld]),
    ]

    expect(buildCanvasOperationMediaThumbnailItems(runs)).toEqual([
      {
        key: 'new:image-new',
        runIndex: 0,
        outputIndex: 1,
        output: imageNew,
        previewUrl: 'new.png',
        previewKind: 'image',
      },
      {
        key: 'new:video-new',
        runIndex: 0,
        outputIndex: 2,
        output: videoNew,
        previewUrl: 'video.mp4',
        previewKind: 'video',
      },
      {
        key: 'old:image-old',
        runIndex: 1,
        outputIndex: 0,
        output: imageOld,
        previewUrl: 'old-thumb.png',
        previewKind: 'image',
      },
    ])
  })

  it('视频存在缩略图时使用图片预览，并过滤不可预览产物', () => {
    const videoWithPoster = output('video-poster', 'video', {
      url: 'video.mp4',
      thumbnailUrl: 'video-poster.jpg',
    })
    const runs = [
      run('run-1', [
        output('image-empty', 'image'),
        output('video-empty', 'video'),
        output('audio', 'audio', { url: 'audio.mp3' }),
        output('text', 'text'),
        videoWithPoster,
      ]),
    ]

    expect(buildCanvasOperationMediaThumbnailItems(runs)).toEqual([
      {
        key: 'run-1:video-poster',
        runIndex: 0,
        outputIndex: 4,
        output: videoWithPoster,
        previewUrl: 'video-poster.jpg',
        previewKind: 'image',
      },
    ])
  })
})
