import { describe, expect, it } from 'vitest'
import {
  canvasPlacementRectsOverlap,
  findCollisionFreeCanvasPlacement,
  getCanvasPlacementBounds,
} from './canvasPlacementEngine'

describe('canvasPlacementEngine', () => {
  it('uses the preferred point when the full batch is collision-free', () => {
    const result = findCollisionFreeCanvasPlacement({
      preferred: { x: 500, y: 240 },
      items: [
        { id: 'a', x: 20, y: 30, width: 160, height: 120 },
        { id: 'b', x: 200, y: 30, width: 160, height: 120 },
      ],
      obstacles: [],
    })

    expect(result?.origin).toEqual({ x: 500, y: 240 })
    expect(result?.items).toEqual([
      { id: 'a', x: 500, y: 240, width: 160, height: 120 },
      { id: 'b', x: 680, y: 240, width: 160, height: 120 },
    ])
  })

  it('moves the entire batch together instead of independently scattering members', () => {
    const result = findCollisionFreeCanvasPlacement({
      preferred: { x: 100, y: 100 },
      items: [
        { id: 'a', x: 0, y: 0, width: 100, height: 80 },
        { id: 'b', x: 124, y: 0, width: 160, height: 80 },
      ],
      obstacles: [{ x: 80, y: 80, width: 320, height: 130 }],
      gap: 0,
      searchStep: 100,
    })

    expect(result).not.toBeNull()
    expect(result?.origin).not.toEqual({ x: 100, y: 100 })
    expect((result?.items[1]?.x ?? 0) - (result?.items[0]?.x ?? 0)).toBe(124)
    expect((result?.items[1]?.y ?? 0) - (result?.items[0]?.y ?? 0)).toBe(0)
  })

  it('honors the safety gap around existing nodes and reserved output areas', () => {
    const obstacle = { x: 0, y: 0, width: 100, height: 100 }

    expect(
      canvasPlacementRectsOverlap({ x: 110, y: 0, width: 80, height: 80 }, obstacle, 16),
    ).toBe(true)
    expect(
      canvasPlacementRectsOverlap({ x: 116, y: 0, width: 80, height: 80 }, obstacle, 16),
    ).toBe(false)
  })

  it('computes bounds for heterogeneous nodes before searching', () => {
    expect(
      getCanvasPlacementBounds([
        { x: 20, y: 40, width: 120, height: 80 },
        { x: 180, y: 10, width: 260, height: 220 },
        { x: 40, y: 260, width: 400, height: 100 },
      ]),
    ).toEqual({ x: 20, y: 10, width: 420, height: 350 })
  })

  it('returns null rather than partially placing a batch when the search budget is exhausted', () => {
    const result = findCollisionFreeCanvasPlacement({
      preferred: { x: 0, y: 0 },
      items: [{ id: 'only', x: 0, y: 0, width: 100, height: 100 }],
      obstacles: [{ x: -500, y: -500, width: 1000, height: 1000 }],
      gap: 0,
      searchStep: 50,
      maxRings: 2,
    })

    expect(result).toBeNull()
  })
})
