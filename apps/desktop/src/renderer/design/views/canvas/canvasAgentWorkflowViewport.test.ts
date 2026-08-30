import { describe, expect, it } from 'vitest'
import {
  areCanvasNodesFullyVisible,
  chooseCanvasWorkflowPlacement,
  resolveCanvasViewportBounds,
} from './canvasAgentWorkflowViewport'

const viewport = { x: -100, y: -50, zoom: 1, width: 1200, height: 800 }
const workflowNodes = [
  { x: 0, y: 0, width: 320, height: 220 },
  { x: 416, y: 0, width: 460, height: 300 },
]

describe('canvas agent workflow viewport placement', () => {
  it('places a workflow inside an empty current viewport', () => {
    const result = chooseCanvasWorkflowPlacement({
      viewport,
      workflowNodes,
      obstacles: [],
      fallbackOrigin: { x: 2400, y: 80 },
    })

    expect(result.placement).toBe('viewport')
    expect(result.originX).toBeGreaterThanOrEqual(148)
    expect(result.originY).toBeGreaterThanOrEqual(98)
    expect(result.originX + 876).toBeLessThanOrEqual(1252)
    expect(result.originY + 300).toBeLessThanOrEqual(702)
  })

  it('finds another visible candidate when the viewport center is occupied', () => {
    const wideViewport = { ...viewport, width: 2800 }
    const result = chooseCanvasWorkflowPlacement({
      viewport: wideViewport,
      workflowNodes,
      obstacles: [{ x: 720, y: 180, width: 760, height: 380 }],
      fallbackOrigin: { x: 2400, y: 80 },
    })

    expect(result.placement).toBe('viewport')
    const overlapsObstacle = !(
      result.originX + 876 + 24 <= 720 ||
      720 + 760 + 24 <= result.originX ||
      result.originY + 300 + 24 <= 180 ||
      180 + 380 + 24 <= result.originY
    )
    expect(overlapsObstacle).toBe(false)
  })

  it('uses the fallback origin when the workflow cannot fit in the viewport', () => {
    expect(
      chooseCanvasWorkflowPlacement({
        viewport: { x: 0, y: 0, zoom: 1, width: 640, height: 480 },
        workflowNodes,
        obstacles: [],
        fallbackOrigin: { x: 2400, y: 80 },
      }),
    ).toEqual({ originX: 2400, originY: 80, placement: 'canvas_outside' })
  })

  it('reports complete visibility using the live viewport bounds', () => {
    const bounds = resolveCanvasViewportBounds(viewport)
    expect(bounds).toEqual({ left: 100, top: 50, right: 1300, bottom: 850 })
    expect(
      areCanvasNodesFullyVisible([{ x: 180, y: 140, width: 320, height: 220 }], viewport),
    ).toBe(true)
    expect(
      areCanvasNodesFullyVisible([{ x: 1100, y: 700, width: 320, height: 220 }], viewport),
    ).toBe(false)
  })
})
