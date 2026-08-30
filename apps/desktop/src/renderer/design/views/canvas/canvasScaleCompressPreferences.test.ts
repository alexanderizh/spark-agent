// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  CANVAS_SCALE_COMPRESS_PREFERENCES_KEY,
  readCanvasScaleCompressPreferences,
  writeCanvasScaleCompressPreferences,
} from './canvasScaleCompressPreferences'

describe('canvas scale compress preferences', () => {
  beforeEach(() => window.localStorage.clear())

  it('returns defaults when nothing has been persisted', () => {
    expect(readCanvasScaleCompressPreferences('image')).toEqual({
      scalePercent: 100,
      compressPercent: 50,
    })
    expect(readCanvasScaleCompressPreferences('video')).toEqual({
      scalePercent: 100,
      compressPercent: 50,
    })
  })

  it('restores the last chosen parameters for the same kind', () => {
    writeCanvasScaleCompressPreferences('image', { scalePercent: 75, compressPercent: 30 })

    expect(readCanvasScaleCompressPreferences('image')).toEqual({
      scalePercent: 75,
      compressPercent: 30,
    })
  })

  it('keeps image and video preferences isolated', () => {
    writeCanvasScaleCompressPreferences('image', { scalePercent: 75, compressPercent: 30 })
    writeCanvasScaleCompressPreferences('video', { scalePercent: 50, compressPercent: 20 })

    expect(readCanvasScaleCompressPreferences('image')).toEqual({
      scalePercent: 75,
      compressPercent: 30,
    })
    expect(readCanvasScaleCompressPreferences('video')).toEqual({
      scalePercent: 50,
      compressPercent: 20,
    })
  })

  it('clamps out-of-range values when writing', () => {
    writeCanvasScaleCompressPreferences('image', { scalePercent: 500, compressPercent: 0 })

    expect(readCanvasScaleCompressPreferences('image')).toEqual({
      scalePercent: 200,
      compressPercent: 10,
    })
  })

  it('falls back to defaults for corrupted or non-numeric stored data', () => {
    window.localStorage.setItem(
      CANVAS_SCALE_COMPRESS_PREFERENCES_KEY,
      JSON.stringify({ image: { scalePercent: 'oops', compressPercent: null } }),
    )

    expect(readCanvasScaleCompressPreferences('image')).toEqual({
      scalePercent: 100,
      compressPercent: 50,
    })
  })

  it('falls back to defaults when the stored JSON is invalid', () => {
    window.localStorage.setItem(CANVAS_SCALE_COMPRESS_PREFERENCES_KEY, '{not-json')

    expect(readCanvasScaleCompressPreferences('image')).toEqual({
      scalePercent: 100,
      compressPercent: 50,
    })
  })

  it('ignores an unknown kind entry without breaking the rest of the store', () => {
    window.localStorage.setItem(
      CANVAS_SCALE_COMPRESS_PREFERENCES_KEY,
      JSON.stringify({ other: { scalePercent: 10, compressPercent: 10 } }),
    )

    expect(readCanvasScaleCompressPreferences('video')).toEqual({
      scalePercent: 100,
      compressPercent: 50,
    })
  })
})
