// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeroUsageHeatmap } from './HeroUsageHeatmap'
import { HERO_USAGE_RANGE, useEmptyHeroUsage } from './useEmptyHeroUsage'
import type { UsageHeatmapDailyGroup } from '../usageHeatmap.utils'
import { clearUsageHeatmapCache, writeUsageHeatmapCache } from '../usageHeatmapCache'

vi.mock('@lobehub/ui', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function makeGroup(overrides?: Partial<UsageHeatmapDailyGroup>): UsageHeatmapDailyGroup {
  return {
    date: new Date().toISOString().slice(0, 10),
    totalInputTokens: 1_000,
    totalOutputTokens: 200,
    totalReasoningOutputTokens: 0,
    totalCostUsd: 0,
    recordCount: 2,
    ...overrides,
  }
}

/** 生成 N 个互不连续活跃日（间隔一天，验证热力图阈值不要求连续）。 */
function makeSparseActiveDays(days: number): UsageHeatmapDailyGroup[] {
  return Array.from({ length: days }, (_, i) => makeGroup({ date: isoDaysAgo(i * 2) }))
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

/** 渲染 useEmptyHeroUsage 并把数据规模 / 加载态写进 DOM，供 hook 行为断言。 */
function HeroUsageProbe({ enabled }: { enabled: boolean }) {
  const usage = useEmptyHeroUsage(enabled)
  return (
    <div>
      <span data-testid="hero-usage-days">{usage.dailyGroups.length}</span>
      <span data-testid="hero-usage-loading">{String(usage.loading)}</span>
    </div>
  )
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

function mount(node: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  act(() => root.render(node))
  return container
}

async function flushAsync() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 10))
  })
}

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (item == null) break
    act(() => item.root.unmount())
    item.container.remove()
  }
  // 缓存是模块级 + localStorage 的单例，逐用例清空避免相互污染。
  clearUsageHeatmapCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const usageDays = (container: HTMLDivElement) =>
  container.querySelector('[data-testid="hero-usage-days"]')?.textContent

const usageLoading = (container: HTMLDivElement) =>
  container.querySelector('[data-testid="hero-usage-loading"]')?.textContent

describe('useEmptyHeroUsage', () => {
  it('requests 16w usage once and hands the daily groups to the heatmap', async () => {
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: makeSparseActiveDays(5) })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageProbe enabled />)

    // 首帧还没有数据，只标记为加载中；空会话照旧渲染热力图空网格，不切换形态。
    expect(usageDays(container)).toBe('0')
    expect(usageLoading(container)).toBe('true')
    await flushAsync()
    expect(usageDays(container)).toBe('5')
    expect(usageLoading(container)).toBe('false')
    expect(invoke).toHaveBeenCalledTimes(1)
    const request = invoke.mock.calls[0]?.[1] as { startDate: string; endDate: string }
    expect(Date.parse(request.endDate) - Date.parse(request.startDate)).toBe(
      16 * 7 * 24 * 60 * 60 * 1000 - 1,
    )
  })

  it('still yields an empty grid (no error) when the account has no usage at all', async () => {
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: [] })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageProbe enabled />)
    await flushAsync()

    expect(usageDays(container)).toBe('0')
    expect(usageLoading(container)).toBe('false')
  })

  it('silently degrades to an empty grid when usage loading fails', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('db locked'))
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageProbe enabled />)
    await flushAsync()

    expect(usageDays(container)).toBe('0')
    expect(usageLoading(container)).toBe('false')
  })

  it('skips IPC when disabled', async () => {
    const invoke = vi.fn()
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageProbe enabled={false} />)
    await flushAsync()

    expect(usageDays(container)).toBe('0')
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('useEmptyHeroUsage 缓存优先（首帧即渲染已有数据）', () => {
  it('再次进入空会话时首帧直接拿到上次结果，不经过 0 值首帧', async () => {
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: makeSparseActiveDays(3) })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    // 首次进入没有任何缓存，仍会经过一次空首帧（一次性成本）。
    const first = mount(<HeroUsageProbe enabled />)
    expect(usageDays(first)).toBe('0')
    await flushAsync()
    expect(usageDays(first)).toBe('3')

    // 再次进入空会话（新建会话 / 重启应用后首帧）：命中缓存，首帧就有数据。
    const second = mount(<HeroUsageProbe enabled />)
    expect(usageDays(second)).toBe('3')
    expect(usageLoading(second)).toBe('false')
  })

  it('已有缓存数据时后台刷新失败也不清空已展示的数据', async () => {
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: makeSparseActiveDays(2) })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const warm = mount(<HeroUsageProbe enabled />)
    await flushAsync()
    expect(usageDays(warm)).toBe('2')

    const failing = vi.fn().mockRejectedValue(new Error('db locked'))
    ;(window as unknown as { spark: { invoke: typeof failing } }).spark = { invoke: failing }

    const restored = mount(<HeroUsageProbe enabled />)
    expect(usageDays(restored)).toBe('2')
    await flushAsync()
    expect(usageDays(restored)).toBe('2')
  })

  it('命中缓存时即使处于禁用态也直接给出数据，且不发 IPC', async () => {
    writeUsageHeatmapCache(HERO_USAGE_RANGE, makeSparseActiveDays(2))
    const invoke = vi.fn()
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageProbe enabled={false} />)
    expect(usageDays(container)).toBe('2')
    await flushAsync()
    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('HeroUsageHeatmap', () => {
  it('renders the compact footprint with summary, cells, and stats entry', () => {
    const onOpenStats = vi.fn()

    const container = mount(
      <HeroUsageHeatmap dailyGroups={[makeGroup()]} onOpenStats={onOpenStats} />,
    )

    expect(container.textContent).toContain('最近 16 周 · 累计 1.2K tokens · 活跃 1 天')
    expect(container.textContent).toContain('单日最高 1.2K')
    expect(container.querySelectorAll('.usage-heatmap-cell').length).toBeGreaterThan(0)
    expect(container.querySelector('[title*="1.2K tokens"]')).not.toBeNull()

    act(() => {
      container.querySelector<HTMLButtonElement>('.hero-usage-link')?.click()
    })
    expect(onOpenStats).toHaveBeenCalledTimes(1)
  })

  it('renders an empty grid with the no-usage copy when there is no usage record', () => {
    const container = mount(<HeroUsageHeatmap dailyGroups={[]} onOpenStats={vi.fn()} />)

    expect(container.textContent).toContain('最近 16 周 · 累计 0 tokens · 活跃 0 天')
    expect(container.textContent).toContain('暂无用量记录')
    expect(container.querySelectorAll('.usage-heatmap-week').length).toBeGreaterThan(0)
  })

  it('shows the loading copy instead of a zeroed summary on the first load', () => {
    const container = mount(<HeroUsageHeatmap dailyGroups={[]} loading onOpenStats={vi.fn()} />)

    expect(container.textContent).toContain('最近 16 周 · 正在读取用量…')
    expect(container.textContent).toContain('正在读取用量…')
    expect(container.textContent).not.toContain('累计 0 tokens')
  })
})

describe('HeroUsageHeatmap 宽度自适应（16 周 ↔ 6 个月）', () => {
  /** stub 全局 ResizeObserver，返回触发回调的函数（模拟 hero stack 宽度变化）。 */
  function stubResizeObserver(): (width: number) => void {
    let callback: ((entries: Array<{ contentRect: { width: number } }>) => void) | null = null
    class MockResizeObserver {
      constructor(cb: NonNullable<typeof callback>) {
        callback = cb
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    return (width: number) => {
      act(() => callback?.([{ contentRect: { width } }]))
    }
  }

  it('容器足够宽时拉长为近 6 个月，并按 6m 范围拉取数据', async () => {
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: [] })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }
    const fireResize = stubResizeObserver()

    const container = mount(
      <HeroUsageHeatmap dailyGroups={[makeGroup()]} onOpenStats={vi.fn()} />,
    )
    // 初始按 16 周渲染，宽档数据未启用、不发 IPC。
    expect(container.textContent).toContain('最近 16 周')
    expect(invoke).not.toHaveBeenCalled()

    fireResize(880)
    await flushAsync()

    expect(container.textContent).toContain('最近 6 个月')
    expect(container.querySelectorAll('.usage-heatmap-week').length).toBeGreaterThan(20)
    expect(invoke).toHaveBeenCalledTimes(1)
    const request = invoke.mock.calls[0]?.[1] as { startDate: string; endDate: string }
    expect(Date.parse(request.endDate) - Date.parse(request.startDate)).toBe(
      180 * 24 * 60 * 60 * 1000 - 1,
    )
  })

  it('窄容器保持 16 周且不触发宽档 IPC', async () => {
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: [] })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }
    const fireResize = stubResizeObserver()

    const container = mount(
      <HeroUsageHeatmap dailyGroups={[makeGroup()]} onOpenStats={vi.fn()} />,
    )
    fireResize(500)
    await flushAsync()

    expect(container.textContent).toContain('最近 16 周')
    expect(container.querySelectorAll('.usage-heatmap-week').length).toBeLessThan(20)
    expect(invoke).not.toHaveBeenCalled()
  })
})
