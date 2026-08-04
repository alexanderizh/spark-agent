import { describe, expect, it } from 'vitest'
import type { WorkbenchKeyframe } from './videoWorkbench.types'
import {
  getKeyframeCanvasGridPosition,
  getKeyframeCanvasNodeSize,
  getKeyframeImportTitle,
  selectKeyframesForRemoval,
  selectKeyframesForImport,
} from './videoWorkbenchKeyframeImport'

function makeKeyframe(index: number, timestampSec: number): WorkbenchKeyframe {
  return {
    index,
    path: `/tmp/keyframe-${index}.jpg`,
    previewUrl: `safe-file://keyframe-${index}`,
    timestampSec,
  }
}

describe('videoWorkbenchKeyframeImport', () => {
  it('filters selected keyframes while preserving the extracted frame order', () => {
    const frames = [makeKeyframe(0, 0), makeKeyframe(1, 1), makeKeyframe(2, 2)]

    expect(selectKeyframesForImport(frames, new Set([2, 0]))).toEqual([frames[0], frames[2]])
  })

  it('skips keyframes that already have a canvas node', () => {
    const frames = [{ ...makeKeyframe(0, 0), canvasNodeId: 'canvas-0' }, makeKeyframe(1, 1)]

    expect(selectKeyframesForImport(frames, new Set([0, 1]))).toEqual([frames[1]])
  })

  it('keeps imported keyframes in the batch selected for deletion', () => {
    const frames = [
      { ...makeKeyframe(0, 0), canvasNodeId: 'canvas-0' },
      makeKeyframe(1, 1),
      { ...makeKeyframe(2, 2), canvasNodeId: 'canvas-2' },
    ]

    expect(selectKeyframesForRemoval(frames, new Set([2, 0]))).toEqual([frames[0], frames[2]])
  })

  it('numbers imported keyframes consecutively from one', () => {
    expect(getKeyframeImportTitle(0)).toBe('关键帧 01')
    expect(getKeyframeImportTitle(1)).toBe('关键帧 02')
    expect(getKeyframeImportTitle(9)).toBe('关键帧 10')
  })

  it('places keyframes left to right and then top to bottom in a grid', () => {
    const origin = { x: 100, y: 200 }
    const nodeSize = { width: 320, height: 180 }

    expect(getKeyframeCanvasGridPosition(0, origin, nodeSize)).toEqual({ x: 100, y: 200 })
    expect(getKeyframeCanvasGridPosition(1, origin, nodeSize)).toEqual({ x: 444, y: 200 })
    expect(getKeyframeCanvasGridPosition(3, origin, nodeSize)).toEqual({ x: 1132, y: 200 })
    expect(getKeyframeCanvasGridPosition(4, origin, nodeSize)).toEqual({ x: 100, y: 404 })
  })

  it('keeps the imported node height proportional to the keyframe pixels', () => {
    expect(getKeyframeCanvasNodeSize(1920, 1080)).toEqual({ width: 320, height: 180 })
    expect(getKeyframeCanvasNodeSize(1080, 1920)).toEqual({ width: 320, height: 569 })
    expect(getKeyframeCanvasNodeSize(0, 0)).toEqual({ width: 320, height: 180 })
  })
})
