import { describe, expect, it } from 'vitest'
import {
  depthEncoderInputPixelFormat,
  MAX_DEPTH_CONTRAST,
  resolveDepthVideoRenderOptions,
} from './depthRenderOptions'

describe('depthRenderOptions', () => {
  it('falls back to the historical defaults when options are missing', () => {
    expect(resolveDepthVideoRenderOptions()).toEqual({
      invert: false,
      colormap: 'none',
      smoothStrength: 0.25,
      contrast: 2,
    })
    expect(resolveDepthVideoRenderOptions(null)).toEqual(resolveDepthVideoRenderOptions())
  })

  it('keeps valid values and clamps out-of-range numbers', () => {
    expect(
      resolveDepthVideoRenderOptions({
        invert: true,
        colormap: 'viridis',
        smoothStrength: 0.9,
        contrast: 8,
      }),
    ).toEqual({ invert: true, colormap: 'viridis', smoothStrength: 0.9, contrast: 8 })
    expect(
      resolveDepthVideoRenderOptions({
        smoothStrength: 5,
        contrast: 999,
      }),
    ).toEqual({
      invert: false,
      colormap: 'none',
      smoothStrength: 1,
      contrast: MAX_DEPTH_CONTRAST,
    })
    expect(resolveDepthVideoRenderOptions({ smoothStrength: -1, contrast: -5 })).toEqual({
      invert: false,
      colormap: 'none',
      smoothStrength: 0,
      contrast: 0,
    })
  })

  it('rejects unknown colormaps and non-numeric fields instead of throwing', () => {
    expect(
      resolveDepthVideoRenderOptions({
        colormap: 'rainbow' as never,
        smoothStrength: 'fast' as never,
      }),
    ).toEqual(resolveDepthVideoRenderOptions())
  })

  it('derives the encoder input pixel format from the colormap', () => {
    expect(depthEncoderInputPixelFormat(resolveDepthVideoRenderOptions())).toBe('gray')
    expect(
      depthEncoderInputPixelFormat(resolveDepthVideoRenderOptions({ colormap: 'turbo' })),
    ).toBe('rgb24')
    expect(
      depthEncoderInputPixelFormat(resolveDepthVideoRenderOptions({ colormap: 'viridis' })),
    ).toBe('rgb24')
  })
})
