/**
 * 常驻提示（sticky）可见性策略的聚焦测试。
 *
 * 背景：base-ui 的 Toast 在存活条数超过可见上限时会把「最旧」的一条标记为
 * limited（opacity: 0 + inert）。常驻提示最早入队，因此拥堵时反而先被隐藏；
 * 这里锁住"该不该把常驻条重建置顶"的判定，避免以后改动把它改回"先隐藏自己"。
 */
import { describe, expect, it } from 'vitest'
import { shouldRepinStickyToast } from './toast-sticky-policy'

const LIMIT = 5

function live(...stickyFlags: boolean[]): { sticky: boolean }[] {
  return stickyFlags.map((sticky) => ({ sticky }))
}

describe('shouldRepinStickyToast', () => {
  it('队列未满时不重建', () => {
    expect(shouldRepinStickyToast(live(true, false, false, false), LIMIT)).toBe(false)
    expect(shouldRepinStickyToast(live(), LIMIT)).toBe(false)
  })

  it('队列满且最旧的是常驻条时重建（否则它会先被隐藏）', () => {
    const queue = live(true, false, false, false, false)
    expect(queue).toHaveLength(LIMIT)
    expect(shouldRepinStickyToast(queue, LIMIT)).toBe(true)
  })

  it('队列超上限（含退场未清理）且最旧的是常驻条时同样重建', () => {
    expect(shouldRepinStickyToast(live(true, false, false, false, false, false), LIMIT)).toBe(true)
  })

  it('常驻条已不是最旧（已被置顶）时不重复重建', () => {
    expect(shouldRepinStickyToast(live(false, false, true, false, false), LIMIT)).toBe(false)
    expect(shouldRepinStickyToast(live(false, false, false, false, true), LIMIT)).toBe(false)
  })

  it('没有常驻条时永不动队列', () => {
    expect(shouldRepinStickyToast(live(false, false, false, false, false), LIMIT)).toBe(false)
  })
})
