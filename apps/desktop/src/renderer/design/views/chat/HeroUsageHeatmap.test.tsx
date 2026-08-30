// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeroUsageHeatmap } from './HeroUsageHeatmap'
import { resolveEmptyHeroUsageMode, useEmptyHeroUsage } from './useEmptyHeroUsage'
import type { UsageHeatmapDailyGroup } from '../usageHeatmap.utils'

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

/** 渲染 useEmptyHeroUsage 并把 mode 写进 DOM，供 hook 行为断言。 */
function HeroUsageModeProbe({ enabled }: { enabled: boolean }) {
  const usage = useEmptyHeroUsage(enabled)
  return <div data-testid="hero-usage-mode">{usage.mode}</div>
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
  vi.restoreAllMocks()
})

describe('resolveEmptyHeroUsageMode', () => {
  it('maps loading / error / active days onto hero layout modes', () => {
    // HERO_USAGE_MIN_ACTIVE_DAYS 已在 d1554c00 调整为 0：任意一天有数据即展示热力图。
    expect(resolveEmptyHeroUsageMode(true, null, 0)).toBe('pending')
    expect(resolveEmptyHeroUsageMode(false, null, 5)).toBe('heatmap')
    expect(resolveEmptyHeroUsageMode(false, null, 1)).toBe('heatmap')
    expect(resolveEmptyHeroUsageMode(false, null, 0)).toBe('cards')
    expect(resolveEmptyHeroUsageMode(false, 'boom', 30)).toBe('cards')
  })
})

describe('useEmptyHeroUsage', () => {
  it('requests 16w usage once and reports heatmap mode beyond the active-day threshold', async () => {
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: makeSparseActiveDays(5) })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageModeProbe enabled />)

    expect(container.textContent).toBe('pending')
    await flushAsync()
    expect(container.textContent).toBe('heatmap')
    expect(invoke).toHaveBeenCalledTimes(1)
    const request = invoke.mock.calls[0]?.[1] as { startDate: string; endDate: string }
    expect(Date.parse(request.endDate) - Date.parse(request.startDate)).toBe(
      16 * 7 * 24 * 60 * 60 * 1000 - 1,
    )
  })

  it('keeps quick cards when there is no active day at all', async () => {
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: [] })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageModeProbe enabled />)
    await flushAsync()

    expect(container.textContent).toBe('cards')
  })

  it('falls back to quick cards when there is no usage record', async () => {
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: [] })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageModeProbe enabled />)
    await flushAsync()

    expect(container.textContent).toBe('cards')
  })

  it('silently falls back to quick cards when usage loading fails', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('db locked'))
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageModeProbe enabled />)
    await flushAsync()

    expect(container.textContent).toBe('cards')
  })

  it('stays pending and skips IPC when disabled', async () => {
    const invoke = vi.fn()
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mount(<HeroUsageModeProbe enabled={false} />)
    await flushAsync()

    expect(container.textContent).toBe('pending')
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
})
