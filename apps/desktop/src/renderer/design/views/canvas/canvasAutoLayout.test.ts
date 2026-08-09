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

  it('keeps grid order based on visible top-left positions even when nodes are connected', () => {
    const result = arrangeCanvasNodes(
      [
        { id: 'lower', x: 0, y: 200, width: 100, height: 50 },
        { id: 'upper-right', x: 300, y: 130, width: 100, height: 50 },
        { id: 'upper-left', x: 100, y: 100, width: 100, height: 50, headerHeight: 20 },
        { id: 'linked-root', x: 500, y: 300, width: 100, height: 50 },
      ],
      {
        mode: 'grid',
        spacing: 'small',
        columns: 2,
        links: [{ sourceId: 'linked-root', targetId: 'upper-left' }],
      },
    )

    expect(result).toEqual([
      { id: 'upper-left', x: 0, y: 100 },
      { id: 'upper-right', x: 132, y: 80 },
      { id: 'lower', x: 0, y: 182 },
      { id: 'linked-root', x: 132, y: 182 },
    ])
  })

  it('keeps the existing node order when grid positions are identical', () => {
    const result = arrangeCanvasNodes(
      [
        { id: 'z-node', x: 100, y: 100, width: 100, height: 50 },
        { id: 'a-node', x: 100, y: 100, width: 100, height: 50 },
        { id: 'm-node', x: 300, y: 100, width: 100, height: 50 },
      ],
      { mode: 'grid', spacing: 'small', columns: 2 },
    )

    expect(result.map((position) => position.id)).toEqual(['z-node', 'a-node', 'm-node'])
  })

  it('honors a custom column count for grid layout', () => {
    const result = arrangeCanvasNodes(nodes, { mode: 'grid', spacing: 'large', columns: 3 })

    expect(result).toEqual([
      { id: 'a', x: 20, y: 40 },
      { id: 'b', x: 356, y: 40 },
      { id: 'd', x: 612, y: 40 },
      { id: 'c', x: 20, y: 340 },
    ])
  })

  it('falls back to a single column when columns is 1', () => {
    const result = arrangeCanvasNodes(nodes, { mode: 'grid', spacing: 'large', columns: 1 })

    expect(result).toEqual([
      { id: 'a', x: 20, y: 40 },
      { id: 'b', x: 20, y: 280 },
      { id: 'd', x: 20, y: 580 },
      { id: 'c', x: 20, y: 840 },
    ])
  })

  it('lays nodes in a single row when columns exceeds node count', () => {
    const result = arrangeCanvasNodes(nodes, { mode: 'grid', spacing: 'large', columns: 10 })

    expect(result).toEqual([
      { id: 'a', x: 20, y: 40 },
      { id: 'b', x: 316, y: 40 },
      { id: 'd', x: 572, y: 40 },
      { id: 'c', x: 848, y: 40 },
    ])
  })

  it('ignores invalid columns and falls back to sqrt', () => {
    const sqrtResult = arrangeCanvasNodes(nodes, { mode: 'grid', spacing: 'large' })
    const zeroColumns = arrangeCanvasNodes(nodes, { mode: 'grid', spacing: 'large', columns: 0 })
    const negativeColumns = arrangeCanvasNodes(nodes, {
      mode: 'grid',
      spacing: 'large',
      columns: -2,
    })
    expect(zeroColumns).toEqual(sqrtResult)
    expect(negativeColumns).toEqual(sqrtResult)
  })

  it('ignores columns in horizontal mode', () => {
    const horizontal = arrangeCanvasNodes(nodes.slice(0, 2), {
      mode: 'horizontal',
      spacing: 'medium',
      columns: 5,
    })
    expect(horizontal).toEqual([
      { id: 'a', x: 20, y: 40 },
      { id: 'b', x: 284, y: 40 },
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

  it('lays connected nodes vertically by graph depth columns', () => {
    const result = arrangeCanvasNodes(
      [
        { id: 'root', x: 0, y: 10, width: 100, height: 50, headerHeight: 10 },
        { id: 'child-a', x: 200, y: 10, width: 80, height: 40, headerHeight: 10 },
        { id: 'child-b', x: 200, y: 100, width: 80, height: 60, headerHeight: 10 },
        { id: 'grandchild', x: 400, y: 100, width: 120, height: 30, headerHeight: 10 },
      ],
      {
        mode: 'vertical',
        spacing: 'small',
        links: [
          { sourceId: 'root', targetId: 'child-a' },
          { sourceId: 'root', targetId: 'child-b' },
          { sourceId: 'child-b', targetId: 'grandchild' },
        ],
      },
    )

    expect(result).toEqual([
      { id: 'root', x: 0, y: 56 },
      { id: 'child-a', x: 132, y: 10 },
      { id: 'child-b', x: 132, y: 92 },
      { id: 'grandchild', x: 244, y: 107 },
    ])
  })

  it('lays connected nodes horizontally by graph depth rows', () => {
    const result = arrangeCanvasNodes(
      [
        { id: 'root', x: 0, y: 10, width: 100, height: 50, headerHeight: 10 },
        { id: 'child-a', x: 200, y: 10, width: 80, height: 40, headerHeight: 10 },
        { id: 'child-b', x: 200, y: 100, width: 80, height: 60, headerHeight: 10 },
        { id: 'grandchild', x: 400, y: 100, width: 120, height: 30, headerHeight: 10 },
      ],
      {
        mode: 'horizontal',
        spacing: 'small',
        links: [
          { sourceId: 'root', targetId: 'child-a' },
          { sourceId: 'root', targetId: 'child-b' },
          { sourceId: 'child-b', targetId: 'grandchild' },
        ],
      },
    )

    expect(result).toEqual([
      { id: 'root', x: 66, y: 10 },
      { id: 'child-a', x: 0, y: 102 },
      { id: 'child-b', x: 132, y: 102 },
      { id: 'grandchild', x: 112, y: 204 },
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
