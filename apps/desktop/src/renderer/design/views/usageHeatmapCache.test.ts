// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearUsageHeatmapCache,
  readCachedUsageHeatmap,
  writeUsageHeatmapCache,
} from './usageHeatmapCache'
import type { UsageHeatmapDailyGroup } from './usageHeatmap.utils'

const STORAGE_KEY_16W = 'spark-agent:usage-heatmap:16w'

function makeGroup(overrides?: Partial<UsageHeatmapDailyGroup>): UsageHeatmapDailyGroup {
  return {
    date: '2026-01-02',
    totalInputTokens: 1_000,
    totalOutputTokens: 200,
    totalReasoningOutputTokens: 0,
    totalCostUsd: 0.01,
    recordCount: 2,
    ...overrides,
  }
}

beforeEach(() => {
  clearUsageHeatmapCache()
})

describe('usageHeatmapCache', () => {
  it('写入后同一次运行内可同步读取', () => {
    const groups = [makeGroup()]
    writeUsageHeatmapCache('16w', groups)

    expect(readCachedUsageHeatmap('16w')).toEqual(groups)
  })

  it('成功结果会持久化到 localStorage，供重启后首帧读取', () => {
    const groups = [makeGroup()]
    writeUsageHeatmapCache('16w', groups)

    const raw = window.localStorage.getItem(STORAGE_KEY_16W)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toEqual({ version: 1, dailyGroups: groups })
  })

  it('内存为空时可从 localStorage 恢复（模拟重启后的首帧）', () => {
    const groups = [makeGroup({ totalInputTokens: 42 })]
    window.localStorage.setItem(
      STORAGE_KEY_16W,
      JSON.stringify({ version: 1, dailyGroups: groups }),
    )

    expect(readCachedUsageHeatmap('16w')).toEqual(groups)
  })

  it('坏 JSON / 版本不符 / 形状错误一律按无缓存处理', () => {
    window.localStorage.setItem('spark-agent:usage-heatmap:12w', '{not json')
    expect(readCachedUsageHeatmap('12w')).toBeUndefined()

    window.localStorage.setItem(
      'spark-agent:usage-heatmap:6m',
      JSON.stringify({ version: 99, dailyGroups: [makeGroup()] }),
    )
    expect(readCachedUsageHeatmap('6m')).toBeUndefined()

    // 形状不符的条目被丢弃，合法条目保留。
    window.localStorage.setItem(
      'spark-agent:usage-heatmap:1y',
      JSON.stringify({ version: 1, dailyGroups: [makeGroup(), { date: '2026-01-01' }] }),
    )
    expect(readCachedUsageHeatmap('1y')).toEqual([makeGroup()])
  })

  it('没有用量的空数组同样被缓存，可直接判定为「已确认无数据」', () => {
    writeUsageHeatmapCache('16w', [])

    expect(readCachedUsageHeatmap('16w')).toEqual([])
  })

  it('清空缓存后内存与持久化都不再返回数据', () => {
    writeUsageHeatmapCache('16w', [makeGroup()])
    clearUsageHeatmapCache()

    expect(readCachedUsageHeatmap('16w')).toBeUndefined()
    expect(window.localStorage.getItem(STORAGE_KEY_16W)).toBeNull()
  })

  it('localStorage 访问被拒时静默降级为纯内存缓存', () => {
    const denied = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied')
    })

    writeUsageHeatmapCache('16w', [makeGroup()])

    expect(readCachedUsageHeatmap('16w')).toEqual([makeGroup()])
    denied.mockRestore()
  })

  it('localStorage 写入抛错时不影响本次结果', () => {
    const original = window.localStorage
    const throwing = {
      getItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('quota')
      },
      setItem: () => {
        throw new Error('quota')
      },
    }
    Object.defineProperty(window, 'localStorage', { configurable: true, value: throwing })
    try {
      writeUsageHeatmapCache('16w', [makeGroup()])
      expect(readCachedUsageHeatmap('16w')).toEqual([makeGroup()])
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: original })
    }
  })
})
