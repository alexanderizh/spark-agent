import { describe, expect, it } from 'vitest'
import {
  COMPRESS_MAX_PERCENT,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  QUALITY_SEARCH_MAX,
  QUALITY_SEARCH_MIN,
  computeScaledImageSize,
  computeTargetBytes,
  initialQualityBounds,
  nextQualityToProbe,
  outputExtensionFor,
  pickBetterCandidate,
  qualityBoundsExhausted,
  refineQualityBounds,
  resolveOutputFormat,
} from './imageScaleCompressMath.js'

describe('computeScaledImageSize', () => {
  it('scales proportionally at common percents', () => {
    expect(computeScaledImageSize(1920, 1080, 100)).toEqual({ width: 1920, height: 1080 })
    expect(computeScaledImageSize(1920, 1080, 50)).toEqual({ width: 960, height: 540 })
    expect(computeScaledImageSize(1000, 1000, 200)).toEqual({ width: 2000, height: 2000 })
  })

  it('rounds odd sources to nearest integer (no even constraint for images)', () => {
    const result = computeScaledImageSize(1921, 1079, 50)
    expect(result).toEqual({ width: 961, height: 540 })
  })

  it('clamps the longest edge to the dimension limit proportionally', () => {
    const result = computeScaledImageSize(12000, 12000, 200) // 24000 超上限
    expect(result).not.toBeNull()
    if (!result) throw new Error('expected a scaled image size')
    expect(result.width).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION)
    expect(result.height).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION)
    // 等比回缩后仍保持正方形
    expect(result.width).toBe(result.height)
  })

  it('keeps a minimum 1px output for extreme shrinks', () => {
    expect(computeScaledImageSize(10, 10, 10)).toEqual({ width: 1, height: 1 })
  })

  it('limits output pixel count to protect image processing memory', () => {
    const result = computeScaledImageSize(10_000, 10_000, 200)
    expect(result).not.toBeNull()
    if (!result) throw new Error('expected a scaled image size')
    expect(result.width * result.height).toBeLessThanOrEqual(MAX_IMAGE_PIXELS)
    expect(result).toEqual({ width: 10_000, height: 10_000 })
  })

  it('rejects invalid input', () => {
    expect(computeScaledImageSize(1920, 1080, 0)).toBeNull()
    expect(computeScaledImageSize(1920, 1080, -10)).toBeNull()
    expect(computeScaledImageSize(1920, 1080, Number.NaN)).toBeNull()
    expect(computeScaledImageSize(0, 1080, 50)).toBeNull()
    expect(computeScaledImageSize(Number.NaN, 1080, 50)).toBeNull()
  })
})

describe('resolveOutputFormat / outputExtensionFor', () => {
  it('keeps the three mainstream formats untouched', () => {
    expect(resolveOutputFormat('jpeg')).toBe('jpeg')
    expect(resolveOutputFormat('JPG')).toBe('jpeg')
    expect(resolveOutputFormat('png')).toBe('png')
    expect(resolveOutputFormat('webp')).toBe('webp')
  })

  it('maps other formats to png fallback', () => {
    expect(resolveOutputFormat('gif')).toBe('png')
    expect(resolveOutputFormat('tiff')).toBe('png')
    expect(resolveOutputFormat('avif')).toBe('png')
    expect(resolveOutputFormat('')).toBe('png')
  })

  it('derives file extensions from output format', () => {
    expect(outputExtensionFor('jpeg')).toBe('jpg')
    expect(outputExtensionFor('png')).toBe('png')
    expect(outputExtensionFor('webp')).toBe('webp')
  })
})

describe('quality binary search', () => {
  it('starts from the full quality range and probes the midpoint', () => {
    const bounds = initialQualityBounds()
    expect(bounds).toEqual({ low: QUALITY_SEARCH_MIN, high: QUALITY_SEARCH_MAX })
    expect(nextQualityToProbe(bounds)).toBe(
      Math.round((QUALITY_SEARCH_MIN + QUALITY_SEARCH_MAX) / 2),
    )
  })

  it('narrows downward when encoded bytes exceed target', () => {
    const bounds = { low: 10, high: 90 }
    expect(refineQualityBounds(bounds, 50, 900, 500)).toEqual({ low: 10, high: 49 })
  })

  it('narrows upward when encoded bytes are below target', () => {
    const bounds = { low: 10, high: 90 }
    expect(refineQualityBounds(bounds, 50, 300, 500)).toEqual({ low: 51, high: 90 })
  })

  it('marks bounds exhausted once low passes high', () => {
    expect(qualityBoundsExhausted({ low: 52, high: 51 })).toBe(true)
    expect(qualityBoundsExhausted({ low: 51, high: 52 })).toBe(false)
  })
})

describe('pickBetterCandidate', () => {
  it('prefers the candidate closer to target bytes', () => {
    const current = { quality: 40, bytes: 900 }
    const next = { quality: 30, bytes: 520 }
    expect(pickBetterCandidate(current, next, 500)).toBe(next)
    expect(pickBetterCandidate(next, current, 500)).toBe(next)
  })

  it('returns next when no current candidate', () => {
    const next = { quality: 30, bytes: 520 }
    expect(pickBetterCandidate(null, next, 500)).toBe(next)
  })

  it('prefers higher quality on equal absolute error', () => {
    const low = { quality: 30, bytes: 400 }
    const high = { quality: 60, bytes: 600 }
    expect(pickBetterCandidate(low, high, 500)).toBe(high)
    expect(pickBetterCandidate(high, low, 500)).toBe(high)
  })
})

describe('computeTargetBytes', () => {
  it('maps compress percent to target byte count', () => {
    expect(computeTargetBytes(1_000_000, COMPRESS_MAX_PERCENT)).toBe(900_000)
    expect(computeTargetBytes(1_000_000, 50)).toBe(500_000)
    expect(computeTargetBytes(1_000_000, 10)).toBe(100_000)
  })

  it('floors tiny inputs to at least 1 byte', () => {
    expect(computeTargetBytes(3, 10)).toBe(1)
  })
})
