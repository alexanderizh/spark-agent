import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_EXPORT_MAX_PIXELS,
  calculateAnnotationExportBudget,
  formatAnnotationPixelCount,
} from './annotationExportBudget'

describe('annotationExportBudget', () => {
  it('keeps ordinary images at full resolution', () => {
    expect(calculateAnnotationExportBudget(3840, 2160)).toMatchObject({
      level: 'safe',
      recommendedMultiplier: 1,
      outputWidth: 3840,
      outputHeight: 2160,
    })
  })

  it('warns before the hard pixel budget', () => {
    expect(calculateAnnotationExportBudget(8000, 5000).level).toBe('warning')
  })

  it('recommends a proportional downscale above the hard budget', () => {
    const budget = calculateAnnotationExportBudget(16000, 9000)
    expect(budget.level).toBe('downscale')
    expect(budget.outputWidth * budget.outputHeight).toBeLessThanOrEqual(
      ANNOTATION_EXPORT_MAX_PIXELS + 20_000,
    )
    expect(budget.outputWidth / budget.outputHeight).toBeCloseTo(16 / 9, 2)
  })

  it('formats pixel counts for status copy', () => {
    expect(formatAnnotationPixelCount(8_294_400)).toBe('8.3 MP')
    expect(formatAnnotationPixelCount(42_000)).toBe('42 KP')
  })
})
