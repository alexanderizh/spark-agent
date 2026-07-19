import { describe, expect, it } from 'vitest'
import {
  annotationArtboardSize,
  annotationPaddingTranslation,
  clampAnnotationPaddingValue,
  normalizeAnnotationPadding,
  setLinkedAnnotationPadding,
} from './annotationGeometry'

describe('annotationGeometry', () => {
  it('normalizes invalid and excessive padding values', () => {
    expect(
      normalizeAnnotationPadding({ top: -12, right: 32.4, bottom: Number.NaN, left: 9000 }),
    ).toEqual({ top: 0, right: 32, bottom: 0, left: 4096 })
    expect(clampAnnotationPaddingValue(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('calculates the exported artboard size', () => {
    expect(
      annotationArtboardSize(1920, 1080, { top: 40, right: 80, bottom: 120, left: 60 }),
    ).toEqual({ width: 2060, height: 1240 })
  })

  it('translates content only by left and top padding deltas', () => {
    expect(
      annotationPaddingTranslation(
        { top: 20, right: 20, bottom: 20, left: 20 },
        { top: 60, right: 80, bottom: 100, left: 40 },
      ),
    ).toEqual({ x: 20, y: 40 })
  })

  it('creates linked four-edge padding', () => {
    expect(setLinkedAnnotationPadding(96)).toEqual({
      top: 96,
      right: 96,
      bottom: 96,
      left: 96,
    })
  })
})
