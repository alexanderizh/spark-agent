import { describe, expect, it } from 'vitest'
import { isCellInSelection, normalizeGridRect } from './CanvasGridSelectionMatrix'

describe('normalizeGridRect', () => {
  it('正向两点：左上到右下', () => {
    expect(normalizeGridRect({ col: 0, row: 0 }, { col: 2, row: 3 })).toEqual({
      left: 0,
      top: 0,
      right: 2,
      bottom: 3,
      cols: 3,
      rows: 4,
    })
  })

  it('反向两点：右下到左上', () => {
    expect(normalizeGridRect({ col: 3, row: 5 }, { col: 1, row: 2 })).toEqual({
      left: 1,
      top: 2,
      right: 3,
      bottom: 5,
      cols: 3,
      rows: 4,
    })
  })

  it('同行两点', () => {
    expect(normalizeGridRect({ col: 1, row: 2 }, { col: 4, row: 2 })).toEqual({
      left: 1,
      top: 2,
      right: 4,
      bottom: 2,
      cols: 4,
      rows: 1,
    })
  })

  it('同列两点', () => {
    expect(normalizeGridRect({ col: 2, row: 0 }, { col: 2, row: 3 })).toEqual({
      left: 2,
      top: 0,
      right: 2,
      bottom: 3,
      cols: 1,
      rows: 4,
    })
  })

  it('同一点：1×1', () => {
    expect(normalizeGridRect({ col: 3, row: 3 }, { col: 3, row: 3 })).toEqual({
      left: 3,
      top: 3,
      right: 3,
      bottom: 3,
      cols: 1,
      rows: 1,
    })
  })
})

describe('isCellInSelection', () => {
  const sel = normalizeGridRect({ col: 1, row: 1 }, { col: 3, row: 2 })

  it('选区内格子返回 true', () => {
    expect(isCellInSelection({ col: 1, row: 1 }, sel)).toBe(true)
    expect(isCellInSelection({ col: 3, row: 2 }, sel)).toBe(true)
    expect(isCellInSelection({ col: 2, row: 1 }, sel)).toBe(true)
  })

  it('选区外格子返回 false', () => {
    expect(isCellInSelection({ col: 0, row: 0 }, sel)).toBe(false)
    expect(isCellInSelection({ col: 4, row: 2 }, sel)).toBe(false)
    expect(isCellInSelection({ col: 2, row: 3 }, sel)).toBe(false)
  })

  it('null 选区恒为 false', () => {
    expect(isCellInSelection({ col: 0, row: 0 }, null)).toBe(false)
  })
})
