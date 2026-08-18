import { describe, expect, it } from 'vitest'
import { formatTurnDuration } from './turn-duration'

describe('formatTurnDuration', () => {
  it('小于 1s 记为 1s，避免「耗时 0s」噪音', () => {
    expect(formatTurnDuration(0)).toBe('1s')
    expect(formatTurnDuration(400)).toBe('1s')
    expect(formatTurnDuration(999)).toBe('1s')
  })

  it('整秒粒度展示，四舍五入', () => {
    expect(formatTurnDuration(34_000)).toBe('34s')
    expect(formatTurnDuration(34_500)).toBe('35s')
  })

  it('秒档四舍五入到 60s 时保持秒档不跳「1m」', () => {
    // 既有行为：59.999s 舍入为 60s，下一个 tick 才进分钟档
    expect(formatTurnDuration(59_999)).toBe('60s')
  })

  it('≥1m 显示「1m 12s」，整分省略秒', () => {
    expect(formatTurnDuration(60_000)).toBe('1m')
    expect(formatTurnDuration(72_000)).toBe('1m 12s')
    expect(formatTurnDuration(119_500)).toBe('2m')
  })

  it('≥1h 显示「1h 2m」，整点省略分', () => {
    expect(formatTurnDuration(3_600_000)).toBe('1h')
    expect(formatTurnDuration(3_720_000)).toBe('1h 2m')
    expect(formatTurnDuration(7_199_500)).toBe('2h')
  })

  it('负值兜底为 1s（时间倒挂由调用方守卫，此处仅保证不出现负数/NaN）', () => {
    expect(formatTurnDuration(-500)).toBe('1s')
  })
})
