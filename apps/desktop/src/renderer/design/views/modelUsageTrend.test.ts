import { describe, expect, it } from 'vitest'
import {
  buildModelUsageTrendDays,
  getModelUsageTrendRange,
  getModelUsageTrendTokens,
  pickTopModels,
  summarizeModelUsageTrend,
} from './modelUsageTrend.utils'
import type { ModelUsageTrendDailyGroup } from './modelUsageTrend.utils'

function group(overrides: Partial<ModelUsageTrendDailyGroup>): ModelUsageTrendDailyGroup {
  return {
    date: '2026-08-10',
    modelId: 'glm-5.3',
    providerId: 'zhipu',
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningOutputTokens: 0,
    totalCostUsd: 0,
    recordCount: 1,
    ...overrides,
  }
}

describe('model usage trend helpers', () => {
  const now = new Date('2026-08-30T12:00:00.000Z')

  it('returns an inclusive UTC range for the selected period', () => {
    expect(getModelUsageTrendRange('7d', now)).toEqual({
      startDate: '2026-08-24T00:00:00.000Z',
      endDate: '2026-08-30T23:59:59.999Z',
    })
    expect(getModelUsageTrendRange('30d', now).startDate).toBe('2026-08-01T00:00:00.000Z')
  })

  it('counts tokens as input + output + reasoning, clamping negatives', () => {
    expect(
      getModelUsageTrendTokens({
        totalInputTokens: 100,
        totalOutputTokens: 20,
        totalReasoningOutputTokens: 5,
      }),
    ).toBe(125)
    expect(
      getModelUsageTrendTokens({
        totalInputTokens: -10,
        totalOutputTokens: 20,
        totalReasoningOutputTokens: 0,
      }),
    ).toBe(20)
  })

  it('picks the top-5 models by total tokens and never returns zero-usage models', () => {
    const groups = [
      group({ modelId: 'a', totalOutputTokens: 100 }),
      group({ modelId: 'b', totalOutputTokens: 500 }),
      group({ modelId: 'c', totalOutputTokens: 300 }),
      group({ modelId: 'd', totalOutputTokens: 400 }),
      group({ modelId: 'e', totalOutputTokens: 200 }),
      group({ modelId: 'f', totalOutputTokens: 50 }),
      group({ modelId: 'zero', totalOutputTokens: 0 }),
      group({ modelId: 'a', providerId: 'other', totalOutputTokens: 10 }),
    ]

    const top = pickTopModels(groups)
    expect(top.map((m) => m.modelId)).toEqual(['b', 'd', 'c', 'e', 'a'])
    expect(top[0]).toMatchObject({ modelId: 'b', providerId: 'zhipu', totalTokens: 500 })
    // 跨 provider 同名模型是独立系列：zhipu::a (100) 入榜，other::a (10) 是第 6 名被截掉
    expect(top).toHaveLength(5)
    expect(top.at(-1)?.totalTokens).toBe(100)
    expect(top.at(-1)).toMatchObject({ providerId: 'zhipu' })
    expect(top.some((m) => m.providerId === 'other')).toBe(false)
  })

  it('fills missing days with zero segments and ticks every 5th day for 30d', () => {
    const top = pickTopModels([group({ date: '2026-08-30', totalOutputTokens: 700 })])
    const days = buildModelUsageTrendDays(
      '30d',
      [group({ date: '2026-08-30', totalOutputTokens: 700 })],
      top,
      now,
    )

    expect(days).toHaveLength(30)
    expect(days[0]?.date).toBe('2026-08-01')
    expect(days[0]?.totalTokens).toBe(0)
    expect(days.at(-1)?.totalTokens).toBe(700)
    // 8月1日、8月6日……有刻度；8月2日没有
    expect(days[0]?.tickLabel).toBe('8月1日')
    expect(days[5]?.tickLabel).toBe('8月6日')
    expect(days[1]?.tickLabel).toBeUndefined()
  })

  it('ticks every day for 7d and drops out-of-range groups', () => {
    const top = pickTopModels([group({ date: '2026-08-30', totalOutputTokens: 700 })])
    const days = buildModelUsageTrendDays(
      '7d',
      [
        group({ date: '2026-08-30', totalOutputTokens: 700 }),
        group({ date: '2026-08-20', totalOutputTokens: 999 }),
      ],
      top,
      now,
    )

    expect(days).toHaveLength(7)
    expect(days.every((day) => day.tickLabel != null)).toBe(true)
    expect(summarizeModelUsageTrend(days)).toBe(700)
  })

  it('keeps segment order aligned with topModels', () => {
    const groups = [
      group({ modelId: 'big', date: '2026-08-30', totalOutputTokens: 700 }),
      group({ modelId: 'small', date: '2026-08-30', totalOutputTokens: 70 }),
    ]
    const top = pickTopModels(groups)
    const days = buildModelUsageTrendDays('7d', groups, top, now)

    expect(top.map((m) => m.modelId)).toEqual(['big', 'small'])
    expect(days.at(-1)?.segments.map((s) => s.tokens)).toEqual([700, 70])
  })
})
