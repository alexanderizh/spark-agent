import { describe, expect, it } from 'vitest'
import {
  CANVAS_DEPTH_RENDER_DEFAULTS,
  resolveDepthRenderPreference,
} from './canvasDepthRenderPreference'

describe('resolveDepthRenderPreference', () => {
  it('falls back to the historical grayscale defaults when nothing is stored', () => {
    expect(resolveDepthRenderPreference(undefined)).toEqual(CANVAS_DEPTH_RENDER_DEFAULTS)
    expect(resolveDepthRenderPreference(null)).toEqual(CANVAS_DEPTH_RENDER_DEFAULTS)
    expect(resolveDepthRenderPreference({})).toEqual(CANVAS_DEPTH_RENDER_DEFAULTS)
  })

  it('keeps explicitly stored valid preferences', () => {
    expect(
      resolveDepthRenderPreference({
        invert: true,
        colormap: 'turbo',
        smoothStrength: 0.8,
        contrast: 6,
      }),
    ).toEqual({ invert: true, colormap: 'turbo', smoothStrength: 0.8, contrast: 6 })
  })

  it('clamps out-of-range numbers and rejects unknown colormaps', () => {
    expect(
      resolveDepthRenderPreference({
        colormap: 'rainbow',
        smoothStrength: 3,
        contrast: -4,
      }),
    ).toEqual({ invert: false, colormap: 'none', smoothStrength: 1, contrast: 0 })
  })
})
