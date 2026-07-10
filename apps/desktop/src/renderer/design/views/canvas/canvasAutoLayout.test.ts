import { describe, expect, it } from 'vitest'
import {
  arrangeCanvasNodes,
  canvasAutoLayoutGap,
  type CanvasAutoLayoutNode,
} from './canvasAutoLayout'

const nodes: CanvasAutoLayoutNode[] = [
  { id: 'a', x: 20, y: 40, width: 200, height: 120, headerHeight: 24 },
  { id: 'b', x: 260, y: 80, width: 160, height: 180, headerHeight: 24 },
  { id: 'c', x: 100, y: 320, width: 240, height: 100, headerHeight: 24 },
  { id: 'd', x: 460, y: 300, width: 180, height: 140, headerHeight: 24 },
]

describe('arrangeCanvasNodes', () => {
  it('arranges nodes horizontally with their floating headers aligned', () => {
    const result = arrangeCanvasNodes(nodes.slice(0, 2), {
      mode: 'horizontal',
      spacing: 'medium',
    })

    expect(result).toEqual([
      { id: 'a', x: 20, y: 40 },
      { id: 'b', x: 284, y: 40 },
    ])
  })

  it('arranges nodes vertically without overlapping floating headers', () => {
    const result = arrangeCanvasNodes(nodes.slice(0, 2), {
      mode: 'vertical',
      spacing: 'small',
    })

    expect(result).toEqual([
      { id: 'a', x: 20, y: 40 },
      { id: 'b', x: 20, y: 216 },
    ])
  })

  it('uses variable row and column sizes for grid layout', () => {
    const result = arrangeCanvasNodes(nodes, { mode: 'grid', spacing: 'large' })

    expect(result).toEqual([
      { id: 'a', x: 20, y: 40 },
      { id: 'b', x: 316, y: 40 },
      { id: 'd', x: 20, y: 340 },
      { id: 'c', x: 316, y: 340 },
    ])
  })

  it('moves a partial layout past unselected obstacle nodes', () => {
    const result = arrangeCanvasNodes(nodes.slice(0, 2), {
      mode: 'horizontal',
      spacing: 'small',
      obstacles: [{ id: 'fixed', x: 0, y: 0, width: 520, height: 260, headerHeight: 24 }],
    })

    expect(result).toEqual([
      { id: 'a', x: 20, y: 316 },
      { id: 'b', x: 252, y: 316 },
    ])
  })

  it('exposes four increasing spacing levels', () => {
    expect([
      canvasAutoLayoutGap('small'),
      canvasAutoLayoutGap('medium'),
      canvasAutoLayoutGap('large'),
      canvasAutoLayoutGap('extra-large'),
    ]).toEqual([32, 64, 96, 144])
  })
})
