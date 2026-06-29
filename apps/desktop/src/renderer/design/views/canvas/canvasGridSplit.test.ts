import { describe, expect, it } from 'vitest'
import { buildGridCells, gridCellKey, gridCellLabel } from './canvasGridSplit'

describe('canvasGridSplit', () => {
  it('生成稳定的格子 key 与 label', () => {
    expect(gridCellKey(1, 2)).toBe('1:2')
    expect(gridCellLabel(1, 2)).toBe('2-3')
  })

  it('按行列切分整图并覆盖完整范围', () => {
    const cells = buildGridCells(900, 600, 3, 3)
    expect(cells).toHaveLength(9)
    expect(cells[0]).toMatchObject({ x: 0, y: 0, width: 300, height: 200, label: '1-1' })
    expect(cells[8]).toMatchObject({ x: 600, y: 400, width: 300, height: 200, label: '3-3' })
  })

  it('处理不能整除的尺寸时不丢像素', () => {
    const cells = buildGridCells(1001, 1003, 3, 3)
    const rightMost = cells.filter((cell) => cell.col === 2)
    const bottomMost = cells.filter((cell) => cell.row === 2)
    expect(rightMost.length).toBeGreaterThan(0)
    expect(bottomMost.length).toBeGreaterThan(0)
    const rightEdge = rightMost[0]
    const bottomEdge = bottomMost[0]
    expect(rightEdge && rightEdge.x + rightEdge.width).toBe(1001)
    expect(bottomEdge && bottomEdge.y + bottomEdge.height).toBe(1003)
    expect(cells.reduce((max, cell) => Math.max(max, cell.x + cell.width), 0)).toBe(1001)
    expect(cells.reduce((max, cell) => Math.max(max, cell.y + cell.height), 0)).toBe(1003)
  })

  it('非法输入返回空数组', () => {
    expect(buildGridCells(0, 100, 3, 3)).toEqual([])
    expect(buildGridCells(100, 100, 0, 3)).toEqual([])
  })
})
