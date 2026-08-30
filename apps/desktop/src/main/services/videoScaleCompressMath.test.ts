import { describe, expect, it } from 'vitest'
import {
  computeEffectiveDisplaySize,
  computeScaledEvenSize,
  compressPercentToCrf,
  MAX_FFMPEG_DIMENSION,
  planCompression,
} from './videoScaleCompressMath.js'

describe('computeEffectiveDisplaySize', () => {
  it('returns raw size when rotation metadata is absent or zero', () => {
    expect(computeEffectiveDisplaySize(1920, 1080, null)).toEqual({ width: 1920, height: 1080 })
    expect(computeEffectiveDisplaySize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 })
  })

  it('swaps dimensions for ±90/270 rotation', () => {
    expect(computeEffectiveDisplaySize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 })
    expect(computeEffectiveDisplaySize(1920, 1080, -90)).toEqual({ width: 1080, height: 1920 })
    expect(computeEffectiveDisplaySize(1920, 1080, 270)).toEqual({ width: 1080, height: 1920 })
  })

  it('keeps orientation for 180 and rejects invalid input', () => {
    expect(computeEffectiveDisplaySize(1920, 1080, 180)).toEqual({ width: 1920, height: 1080 })
    expect(computeEffectiveDisplaySize(0, 1080)).toBeNull()
    expect(computeEffectiveDisplaySize(Number.NaN, 100)).toBeNull()
  })
})

describe('computeScaledEvenSize', () => {
  it('keeps even output while shrinking to 50%', () => {
    // 1921×1079（奇数源）缩到一半附近也必须落到偶数
    const result = computeScaledEvenSize(1921, 1079, 50)
    expect(result).not.toBeNull()
    expect(result!.width % 2).toBe(0)
    expect(result!.height % 2).toBe(0)
    // 比例误差不超过一个像素步进
    expect(Math.abs(result!.width - 1921 * 0.5)).toBeLessThanOrEqual(2)
  })

  it('supports upscale above 100%', () => {
    const result = computeScaledEvenSize(1280, 720, 200)
    expect(result).toEqual({ width: 2560, height: 1440 })
  })

  it('identity at 100% keeps original display size', () => {
    expect(computeScaledEvenSize(1918, 1078, 100)).toEqual({ width: 1918, height: 1078 })
  })

  it('clamps the longest edge to the FFmpeg limit proportionally', () => {
    const result = computeScaledEvenSize(12000, 12000, 200) // 24000 超上限
    expect(result).not.toBeNull()
    expect(result!.width).toBeLessThanOrEqual(MAX_FFMPEG_DIMENSION)
    expect(result!.height).toBeLessThanOrEqual(MAX_FFMPEG_DIMENSION)
    expect(result!.width % 2).toBe(0)
    // 等比回缩后仍保持正方形
    expect(result!.width).toBe(result!.height)
  })

  it('rejects non-positive percents and empty sizes', () => {
    expect(computeScaledEvenSize(1920, 1080, 0)).toBeNull()
    expect(computeScaledEvenSize(1920, 1080, -10)).toBeNull()
    expect(computeScaledEvenSize(Number.NaN, 100, 50)).toBeNull()
  })
})

describe('planCompression', () => {
  it('derives video bitrate from probe total bitrate minus audio reserve', () => {
    const plan = planCompression({
      totalBitrateBps: 2_000_000,
      hasAudio: true,
      compressPercent: 50,
    })
    expect(plan).toEqual({
      mode: 'bitrate',
      videoBitrateBps: 1_000_000 - 128_000,
      audioBitrateBps: 128_000,
    })
  })

  it('falls back to file-size-derived bitrate when format bit_rate missing', () => {
    // 10MB、20s → 总码率 4_000_000bps；压到 25% → 1M，含音轨预留
    const plan = planCompression({
      durationSec: 20,
      fileSizeBytes: 10 * 1024 * 1024,
      hasAudio: true,
      compressPercent: 25,
    })
    expect(plan.mode).toBe('bitrate')
    if (plan.mode !== 'bitrate') return
    expect(plan.videoBitrateBps).toBeGreaterThan(0)
    expect(plan.videoBitrateBps).toBeLessThanOrEqual(1_000_000)
  })

  it('enforces a floor for tiny targets and skips audio reserve without audio', () => {
    const floored = planCompression({ totalBitrateBps: 300_000, hasAudio: true, compressPercent: 10 })
    if (floored.mode !== 'bitrate') throw new Error('expected bitrate mode')
    expect(floored.videoBitrateBps).toBeGreaterThanOrEqual(100_000)

    const noAudio = planCompression({ totalBitrateBps: 2_000_000, hasAudio: false, compressPercent: 90 })
    expect(noAudio).toEqual({ mode: 'bitrate', videoBitrateBps: 1_800_000, audioBitrateBps: 0 })
  })

  it('uses CRF fallback when bitrate cannot be resolved', () => {
    const plan = planCompression({ hasAudio: true, compressPercent: 50 })
    expect(plan).toEqual({ mode: 'quality', crf: compressPercentToCrf(50) })
  })
})

describe('compressPercentToCrf', () => {
  it('maps endpoints linearly: light compression → low CRF', () => {
    expect(compressPercentToCrf(90)).toBe(18)
    expect(compressPercentToCrf(10)).toBe(34)
  })

  it('rounds midpoints onto integers within range', () => {
    const mid = compressPercentToCrf(50)
    expect(mid).toBeGreaterThanOrEqual(18)
    expect(mid).toBeLessThanOrEqual(34)
    expect(Number.isInteger(mid)).toBe(true)
  })

  it('clamps out-of-range percents into the CRF window', () => {
    expect(compressPercentToCrf(500)).toBe(18)
    expect(compressPercentToCrf(-5)).toBe(34)
  })
})
