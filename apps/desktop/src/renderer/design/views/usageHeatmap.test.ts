import { describe, expect, it } from 'vitest'
import {
  buildUsageHeatmapWeeks,
  getUsageHeatmapRange,
  getUsageLevel,
} from './usageHeatmap.utils'

describe('usage heatmap helpers', () => {
  const now = new Date('2026-08-10T12:00:00.000Z')

  it('returns an inclusive UTC range for the selected period', () => {
    expect(getUsageHeatmapRange('12w', now)).toEqual({
      startDate: '2026-05-19T00:00:00.000Z',
      endDate: '2026-08-10T23:59:59.999Z',
    })
  })

  it('builds Sunday-to-Saturday weeks and preserves empty days', () => {
    const weeks = buildUsageHeatmapWeeks(
      '12w',
      [{
        date: '2026-08-10',
        totalInputTokens: 1_000,
        totalOutputTokens: 200,
        totalReasoningOutputTokens: 0,
        totalCostUsd: 0,
        recordCount: 1,
      }],
      now,
    )

    expect(weeks[0]?.days).toHaveLength(7)
    expect(weeks.at(-1)?.days.at(-1)).toMatchObject({
      date: '2026-08-15',
      tokens: 0,
      recordCount: 0,
      inRange: false,
    })
    expect(weeks.at(-1)?.days.at(1)).toMatchObject({
      date: '2026-08-10',
      tokens: 1_200,
      recordCount: 1,
      inRange: true,
    })
  })

  it('maps zero and relative usage to stable visual levels', () => {
    expect(getUsageLevel(0, 1_000)).toBe(0)
    expect(getUsageLevel(100, 1_000)).toBe(1)
    expect(getUsageLevel(500, 1_000)).toBe(2)
    expect(getUsageLevel(800, 1_000)).toBe(3)
    expect(getUsageLevel(1_000, 1_000)).toBe(4)
  })
})
