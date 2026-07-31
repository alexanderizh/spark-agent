import { describe, expect, it } from 'vitest'
import {
  detectRgbSceneCut,
  normalizeInverseDepth,
  resizeGrayFrame,
  smoothDepthFrame,
} from './depthMath'

describe('depthMath', () => {
  it('normalizes higher inverse-depth values to near-white pixels', () => {
    expect(Array.from(normalizeInverseDepth(new Float32Array([1, 2, 3])))).toEqual([0, 128, 255])
  })

  it('returns a stable black frame when the model output is flat', () => {
    expect(Array.from(normalizeInverseDepth(new Float32Array([4, 4, 4])))).toEqual([0, 0, 0])
  })

  it('smooths within a shot but resets history at a scene cut', () => {
    const current = new Uint8Array([200, 100])
    const previous = new Uint8Array([100, 200])
    expect(Array.from(smoothDepthFrame(current, previous, 0.25, false))).toEqual([175, 125])
    expect(smoothDepthFrame(current, previous, 0.25, true)).toBe(current)
  })

  it('detects large RGB luminance changes as scene cuts', () => {
    const dark = new Uint8Array([0, 0, 0, 10, 10, 10])
    const light = new Uint8Array([255, 255, 255, 245, 245, 245])
    expect(detectRgbSceneCut(light, dark)).toBe(true)
    expect(detectRgbSceneCut(dark, dark)).toBe(false)
  })

  it('resizes grayscale depth frames back to the source dimensions', () => {
    expect(Array.from(resizeGrayFrame(new Uint8Array([0, 255]), 2, 1, 4, 1))).toEqual([
      0, 0, 255, 255,
    ])
  })
})
