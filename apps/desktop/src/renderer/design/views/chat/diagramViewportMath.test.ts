import { describe, expect, it } from 'vitest'
import {
  clampDiagramZoom,
  getDiagramFitZoom,
  getPaddedDiagramBounds,
  getDiagramWheelZoom,
  getZoomedScrollPosition,
  parseDiagramViewBox,
  stepDiagramZoom,
} from './diagramViewportMath'

describe('diagram viewport zoom math', () => {
  it('clamps zoom to the supported 50%–300% range', () => {
    expect(clampDiagramZoom(0.1)).toBe(0.5)
    expect(clampDiagramZoom(1.25)).toBe(1.25)
    expect(clampDiagramZoom(4)).toBe(3)
  })

  it('steps toolbar zoom by 10 percentage points', () => {
    expect(stepDiagramZoom(1, 1)).toBe(1.1)
    expect(stepDiagramZoom(1, -1)).toBe(0.9)
    expect(stepDiagramZoom(2.95, 1)).toBe(3)
  })

  it('zooms wheel up in and wheel down out without exceeding limits', () => {
    expect(getDiagramWheelZoom(1, -120)).toBe(1.1)
    expect(getDiagramWheelZoom(1, 120)).toBe(0.9)
    expect(getDiagramWheelZoom(3, -120)).toBe(3)
  })

  it('fits oversized content while never enlarging content above 100%', () => {
    expect(
      getDiagramFitZoom({
        viewportWidth: 800,
        viewportHeight: 500,
        contentWidth: 1600,
        contentHeight: 800,
        padding: 24,
      }),
    ).toBe(0.5)
    expect(
      getDiagramFitZoom({
        viewportWidth: 800,
        viewportHeight: 500,
        contentWidth: 320,
        contentHeight: 180,
        padding: 24,
      }),
    ).toBe(1)
  })

  it('keeps the content point under the cursor stable while zooming', () => {
    expect(
      getZoomedScrollPosition({
        currentZoom: 1,
        nextZoom: 2,
        pointerX: 100,
        pointerY: 80,
        scrollLeft: 40,
        scrollTop: 20,
      }),
    ).toEqual({ scrollLeft: 180, scrollTop: 120 })
  })

  it('keeps SVG viewBox dimensions as the natural diagram size', () => {
    expect(parseDiagramViewBox('0 0 840.5 420')).toEqual({ width: 840.5, height: 420 })
    expect(parseDiagramViewBox('0, 0, 640, 360')).toEqual({ width: 640, height: 360 })
    expect(parseDiagramViewBox('invalid')).toBeNull()
  })

  it('adds padding around markmap layout bounds without scaling them', () => {
    expect(getPaddedDiagramBounds({ x1: -20, y1: -100, x2: 780, y2: 100 }, 32)).toEqual({
      x: -52,
      y: -132,
      width: 864,
      height: 264,
    })
  })
})
