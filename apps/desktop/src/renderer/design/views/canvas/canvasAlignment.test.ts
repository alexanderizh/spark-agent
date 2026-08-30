import { describe, expect, it } from 'vitest'
import { alignCanvasNodes, type CanvasAlignmentNode } from './canvasAlignment'

const nodes: CanvasAlignmentNode[] = [
  { id: 'a', x: 0, y: 0, width: 100, height: 100, headerHeight: 20 },
  { id: 'b', x: 200, y: 50, width: 80, height: 120, headerHeight: 20 },
  { id: 'c', x: 100, y: 200, width: 120, height: 80, headerHeight: 20 },
]

describe('alignCanvasNodes', () => {
  it('aligns nodes to the left edge', () => {
    expect(alignCanvasNodes(nodes, { mode: 'left' })).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 0, y: 50 },
      { id: 'c', x: 0, y: 200 },
    ])
  })

  it('aligns nodes to the right edge with varying widths', () => {
    expect(alignCanvasNodes(nodes, { mode: 'right' })).toEqual([
      { id: 'a', x: 180, y: 0 },
      { id: 'b', x: 200, y: 50 },
      { id: 'c', x: 160, y: 200 },
    ])
  })

  it('aligns nodes to the horizontal center of the bounding box', () => {
    expect(alignCanvasNodes(nodes, { mode: 'center-horizontal' })).toEqual([
      { id: 'a', x: 90, y: 0 },
      { id: 'b', x: 100, y: 50 },
      { id: 'c', x: 80, y: 200 },
    ])
  })

  it('aligns nodes to the top edge (visible top = meta-bar upper edge)', () => {
    expect(alignCanvasNodes(nodes, { mode: 'top' })).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 200, y: 0 },
      { id: 'c', x: 100, y: 0 },
    ])
  })

  it('aligns nodes to the bottom edge with varying heights', () => {
    expect(alignCanvasNodes(nodes, { mode: 'bottom' })).toEqual([
      { id: 'a', x: 0, y: 180 },
      { id: 'b', x: 200, y: 160 },
      { id: 'c', x: 100, y: 200 },
    ])
  })

  it('aligns nodes to the vertical center of the bounding box', () => {
    expect(alignCanvasNodes(nodes, { mode: 'center-vertical' })).toEqual([
      { id: 'a', x: 0, y: 90 },
      { id: 'b', x: 200, y: 80 },
      { id: 'c', x: 100, y: 100 },
    ])
  })

  it('distributes nodes horizontally keeping first/last positions', () => {
    // 按 center X 排序：a(50) < c(160) < b(240)
    expect(alignCanvasNodes(nodes, { mode: 'distribute-horizontal' })).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'c', x: 85, y: 200 },
      { id: 'b', x: 200, y: 50 },
    ])
  })

  it('distributes nodes vertically keeping first/last positions', () => {
    // 按 visibleCenterY 排序：a(40) < b(100) < c(230)
    expect(alignCanvasNodes(nodes, { mode: 'distribute-vertical' })).toEqual([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 200, y: 85 },
      { id: 'c', x: 100, y: 200 },
    ])
  })

  it('aligns visible tops across mixed headerHeight (0/20/38)', () => {
    const mixed: CanvasAlignmentNode[] = [
      { id: 'a', x: 0, y: 10, width: 100, height: 100, headerHeight: 0 },
      { id: 'b', x: 0, y: 30, width: 100, height: 100, headerHeight: 20 },
      { id: 'c', x: 0, y: 48, width: 100, height: 100, headerHeight: 38 },
    ]
    // 三个节点可见顶都是 10；写回 body 顶时加回各自 headerHeight
    expect(alignCanvasNodes(mixed, { mode: 'top' })).toEqual([
      { id: 'a', x: 0, y: 10 },
      { id: 'b', x: 0, y: 30 },
      { id: 'c', x: 0, y: 48 },
    ])
  })

  it('breaks ties in distribute by id to keep ordering stable', () => {
    // d1/d2 center X 相同（50），按 id 排序：d1 在 d2 之前
    const same: CanvasAlignmentNode[] = [
      { id: 'd2', x: 0, y: 0, width: 100, height: 100, headerHeight: 20 },
      { id: 'd1', x: 0, y: 0, width: 100, height: 100, headerHeight: 20 },
      { id: 'd3', x: 300, y: 0, width: 100, height: 100, headerHeight: 20 },
    ]
    expect(alignCanvasNodes(same, { mode: 'distribute-horizontal' })).toEqual([
      { id: 'd1', x: 0, y: 0 },
      { id: 'd2', x: 150, y: 0 },
      { id: 'd3', x: 300, y: 0 },
    ])
  })

  it('returns empty for zero or one node', () => {
    expect(alignCanvasNodes([], { mode: 'left' })).toEqual([])
    expect(alignCanvasNodes(nodes.slice(0, 1), { mode: 'left' })).toEqual([])
  })

  it('returns empty for distribute with fewer than 3 nodes', () => {
    expect(alignCanvasNodes(nodes.slice(0, 2), { mode: 'distribute-horizontal' })).toEqual([])
  })

  it('returns empty when distribute span is zero (all centers coincide)', () => {
    const coincident: CanvasAlignmentNode[] = [
      { id: 'a', x: 0, y: 0, width: 100, height: 100, headerHeight: 20 },
      { id: 'b', x: 0, y: 100, width: 100, height: 100, headerHeight: 20 },
      { id: 'c', x: 0, y: 200, width: 100, height: 100, headerHeight: 20 },
    ]
    expect(alignCanvasNodes(coincident, { mode: 'distribute-horizontal' })).toEqual([])
  })

  it('rounds every output coordinate to an integer', () => {
    const positions = alignCanvasNodes(nodes, { mode: 'center-horizontal' })
    for (const position of positions) {
      expect(Number.isInteger(position.x)).toBe(true)
      expect(Number.isInteger(position.y)).toBe(true)
    }
  })

  it('treats missing headerHeight as zero', () => {
    const noHeader: CanvasAlignmentNode[] = [
      { id: 'a', x: 0, y: 10, width: 100, height: 100 },
      { id: 'b', x: 50, y: 40, width: 100, height: 100 },
    ]
    // 无 headerHeight：top 对齐 bounds.top = min(10, 40) = 10，y = 10 + 0
    expect(alignCanvasNodes(noHeader, { mode: 'top' })).toEqual([
      { id: 'a', x: 0, y: 10 },
      { id: 'b', x: 50, y: 10 },
    ])
  })
})
