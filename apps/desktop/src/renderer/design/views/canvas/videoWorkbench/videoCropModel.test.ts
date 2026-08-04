import { describe, expect, it } from 'vitest'
import {
  cropRectFromPoints,
  isVideoCropPixelsWithinBounds,
  moveVideoCropRect,
  normalizeVideoCropRect,
  resizeVideoCropRect,
  videoCropRectToPixels,
} from './videoCropModel'

describe('videoCropModel', () => {
  it('normalizes a selection so it stays inside the video', () => {
    expect(normalizeVideoCropRect({ x: 0.9, y: -0.2, width: 0.4, height: 0.5 })).toEqual({
      x: 0.6,
      y: 0,
      width: 0.4,
      height: 0.5,
    })
  })

  it('creates a rectangle from a drag in either direction', () => {
    expect(cropRectFromPoints({ x: 0.8, y: 0.75 }, { x: 0.2, y: 0.25 })).toEqual({
      x: 0.2,
      y: 0.25,
      width: 0.6,
      height: 0.5,
    })
  })

  it('moves and resizes without crossing the video bounds', () => {
    const rect = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 }
    expect(moveVideoCropRect(rect, { x: 0.7, y: -0.5 })).toEqual({
      x: 0.6,
      y: 0,
      width: 0.4,
      height: 0.4,
    })
    expect(resizeVideoCropRect(rect, 'se', { x: 0.9, y: 0.9 })).toEqual({
      x: 0.2,
      y: 0.2,
      width: 0.8,
      height: 0.8,
    })
  })

  it('converts a selection to even pixel dimensions for h264 output', () => {
    expect(videoCropRectToPixels({ x: 0.1, y: 0.2, width: 0.5, height: 0.4 }, 1280, 720)).toEqual({
      x: 128,
      y: 144,
      w: 640,
      h: 288,
    })
  })

  it('rejects pixel rectangles that exceed the source video', () => {
    expect(isVideoCropPixelsWithinBounds({ x: 100, y: 80, w: 640, h: 360 }, 1280, 720)).toBe(true)
    expect(isVideoCropPixelsWithinBounds({ x: 700, y: 80, w: 640, h: 360 }, 1280, 720)).toBe(false)
    expect(isVideoCropPixelsWithinBounds({ x: -1, y: 0, w: 640, h: 360 }, 1280, 720)).toBe(false)
  })
})
