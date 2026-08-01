import { describe, expect, it } from 'vitest'
import {
  readCanvasVideoAspectRatio,
  resolveCanvasVideoAspectRatio,
  resolveCanvasVideoNodePresentationSize,
} from './canvasVideoNodePresentation'
import type { CanvasNode } from './canvas.types'

function videoNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'video-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'video',
    x: 0,
    y: 0,
    width: 500,
    height: 300,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { url: 'safe-file://portrait.mp4' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('canvas video node presentation', () => {
  it('repairs an old portrait node using intrinsic dimensions while preserving its width', () => {
    expect(
      resolveCanvasVideoNodePresentationSize(videoNode(), { width: 1080, height: 1920 }),
    ).toEqual({ width: 500, height: 889 })
  })

  it('falls back to dimensions backfilled into node data', () => {
    expect(
      resolveCanvasVideoNodePresentationSize(
        videoNode({ data: { url: 'safe-file://clip.mp4', mediaWidth: 1920, mediaHeight: 1080 } }),
      ),
    ).toEqual({ width: 500, height: 281 })
  })

  it('prefers browser-backfilled intrinsic dimensions over stale asset metadata', () => {
    expect(
      resolveCanvasVideoNodePresentationSize(
        videoNode({
          data: { url: 'safe-file://clip.mp4', mediaWidth: 1080, mediaHeight: 1920 },
        }),
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ width: 500, height: 889 })
  })

  it('does not combine a partial node backfill with an unrelated asset dimension', () => {
    expect(
      resolveCanvasVideoNodePresentationSize(
        videoNode({ data: { url: 'safe-file://clip.mp4', mediaWidth: 1080 } }),
        { width: 1920, height: 1080 },
      ),
    ).toEqual({ width: 500, height: 281 })
  })

  it('reads ratio and dimension model parameters through known aliases', () => {
    expect(readCanvasVideoAspectRatio({ aspect_ratio: '9:16' })).toBeCloseTo(9 / 16)
    expect(readCanvasVideoAspectRatio({ size: '1280x720' })).toBeCloseTo(16 / 9)
    expect(resolveCanvasVideoAspectRatio(undefined, {})).toBeCloseTo(16 / 9)
  })
})
