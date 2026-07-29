import { describe, expect, it } from 'vitest'
import { resolveCanvasZoomLod } from './canvasZoomLod'

describe('resolveCanvasZoomLod', () => {
  it('reduces node chrome below the overview threshold', () => {
    expect(resolveCanvasZoomLod(0.2)).toBe('overview')
    expect(resolveCanvasZoomLod(0.449)).toBe('overview')
  })

  it('uses compact chrome for mid-range navigation', () => {
    expect(resolveCanvasZoomLod(0.45)).toBe('compact')
    expect(resolveCanvasZoomLod(0.799)).toBe('compact')
  })

  it('shows complete controls at editing zoom and handles invalid values safely', () => {
    expect(resolveCanvasZoomLod(0.8)).toBe('detail')
    expect(resolveCanvasZoomLod(1.6)).toBe('detail')
    expect(resolveCanvasZoomLod(Number.NaN)).toBe('overview')
  })
})
