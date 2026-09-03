import { describe, expect, it } from 'vitest'
import {
  applyDepthColormap,
  buildDepthColormapLut,
  DEFAULT_DEPTH_CONTRAST_CLIP_PERCENT,
  detectRgbSceneCut,
  invertGrayValues,
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

  it('keeps the historical default contrast clipping when no clip percent is given', () => {
    // 100 个 0..99 加两个极端离群值：默认 2% 分位裁剪应把离群值压到 0/255。
    const values = new Float32Array([...Array.from({ length: 100 }, (_, i) => i), -1000, 1000])
    const normalized = Array.from(normalizeInverseDepth(values))
    expect(normalized.at(-2)).toBe(0)
    expect(normalized.at(-1)).toBe(255)
    expect(DEFAULT_DEPTH_CONTRAST_CLIP_PERCENT).toBe(2)
  })

  it('spreads mid-tone layers with a higher clip percent and keeps full range at zero', () => {
    const values = new Float32Array([...Array.from({ length: 100 }, (_, i) => i), -1000, 1000])
    const spread = (frame: number[]) => frame[70]! - frame[30]!
    const defaultSpread = spread(Array.from(normalizeInverseDepth(values)))
    // 裁剪越多，线性段映射斜率越大，等距两点的灰度差（对比度）越大。
    expect(spread(Array.from(normalizeInverseDepth(values, 10)))).toBeGreaterThan(defaultSpread)
    // 不裁剪时离群值占据两端，斜率最小，对比度最低。
    expect(spread(Array.from(normalizeInverseDepth(values, 0)))).toBeLessThan(defaultSpread)
  })

  it('inverts grayscale depth values without mutating the input frame', () => {
    const frame = new Uint8Array([0, 128, 255])
    const inverted = invertGrayValues(frame)
    expect(Array.from(inverted)).toEqual([255, 127, 0])
    expect(Array.from(frame)).toEqual([0, 128, 255])
  })

  it('builds 256-entry colormap LUTs with exact endpoint colors', () => {
    expect(buildDepthColormapLut('viridis')).toHaveLength(256 * 3)
    expect(Array.from(buildDepthColormapLut('viridis').slice(0, 3))).toEqual([68, 1, 84])
    expect(Array.from(buildDepthColormapLut('viridis').slice(-3))).toEqual([253, 231, 37])
    expect(Array.from(buildDepthColormapLut('turbo').slice(0, 3))).toEqual([35, 23, 27])
    expect(Array.from(buildDepthColormapLut('turbo').slice(-3))).toEqual([144, 12, 0])
  })

  it('maps grayscale frames to triple-length RGB pseudocolor frames', () => {
    const frame = new Uint8Array([0, 255])
    expect(Array.from(applyDepthColormap(frame, 'viridis'))).toEqual([68, 1, 84, 253, 231, 37])
    expect(applyDepthColormap(frame, 'turbo')).toHaveLength(6)
  })

  it('smooths within a shot but resets history at a scene cut', () => {
    const current = new Uint8Array([200, 100])
    const previous = new Uint8Array([100, 200])
    expect(Array.from(smoothDepthFrame(current, previous, 0.25, false))).toEqual([175, 125])
    expect(smoothDepthFrame(current, previous, 0.25, true)).toBe(current)
  })

  it('returns the current frame untouched when smoothing strength is zero', () => {
    const current = new Uint8Array([200, 100])
    const previous = new Uint8Array([100, 200])
    expect(smoothDepthFrame(current, previous, 0, false)).toBe(current)
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
