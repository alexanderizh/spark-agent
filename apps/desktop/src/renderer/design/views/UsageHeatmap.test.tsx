// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageHeatmap } from './UsageHeatmap'
import { clearUsageHeatmapCache, writeUsageHeatmapCache } from './usageHeatmapCache'
import type { UsageHeatmapDailyGroup } from './usageHeatmap.utils'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Segmented: ({
      onChange,
      options,
      value,
    }: {
      onChange?: (nextValue: string) => void
      options?: Array<{ label: string; value: string }>
      value?: string
    }) =>
      ReactActual.createElement(
        'div',
        { 'data-testid': 'usage-heatmap-range' },
        (options ?? []).map((option) =>
          ReactActual.createElement(
            'button',
            {
              'aria-pressed': option.value === value,
              key: option.value,
              onClick: () => onChange?.(option.value),
              type: 'button',
            },
            option.label,
          ),
        ),
      ),
    Tooltip: ({ children }: { children: React.ReactNode }) => children,
  }
})

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (item == null) break
    act(() => item.root.unmount())
    item.container.remove()
  }
  clearUsageHeatmapCache()
  vi.restoreAllMocks()
})

describe('UsageHeatmap', () => {
  const makeGroup = (): UsageHeatmapDailyGroup => ({
    date: new Date().toISOString().slice(0, 10),
    totalInputTokens: 1_000,
    totalOutputTokens: 200,
    totalReasoningOutputTokens: 0,
    totalCostUsd: 0,
    recordCount: 2,
  })

  it('loads daily usage and exposes an accessible day detail', async () => {
    expect(UsageHeatmap).toBeTypeOf('function')
    const invoke = vi.fn().mockResolvedValue({
      dailyGroups: [
        {
          date: new Date().toISOString().slice(0, 10),
          totalInputTokens: 1_000,
          totalOutputTokens: 200,
          totalReasoningOutputTokens: 0,
          totalCostUsd: 0,
          recordCount: 2,
        },
      ],
    })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => root.render(<UsageHeatmap />))
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(invoke).toHaveBeenCalledWith(
      'usage:get-by-date-range',
      expect.objectContaining({
        endDate: expect.any(String),
        startDate: expect.any(String),
      }),
    )
    const request = invoke.mock.calls[0]?.[1] as {
      endDate: string
      startDate: string
    }
    expect(Date.parse(request.endDate) - Date.parse(request.startDate)).toBe(
      365 * 24 * 60 * 60 * 1000 - 1,
    )
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('1 年')
    expect(container.textContent).toContain('1.2K tokens')
    expect(container.querySelector('[aria-label*="次请求"]')).not.toBeNull()
    expect(container.querySelector('[title*="1.2K tokens"]')).not.toBeNull()
  })

  it('命中缓存时首帧直接渲染图表，不再先闪一次骨架屏', () => {
    writeUsageHeatmapCache('1y', [makeGroup()])
    const invoke = vi.fn().mockResolvedValue({ dailyGroups: [makeGroup()] })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    act(() => root.render(<UsageHeatmap />))

    expect(container.querySelector('.usage-heatmap-loading')).toBeNull()
    expect(container.textContent).toContain('1.2K tokens')
  })

  it('刷新失败但已有缓存数据时保留图表并提示错误', async () => {
    writeUsageHeatmapCache('1y', [makeGroup()])
    const invoke = vi.fn().mockRejectedValue(new Error('db locked'))
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })
    await act(async () => root.render(<UsageHeatmap />))
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(container.textContent).toContain('用量数据加载失败')
    expect(container.textContent).toContain('1.2K tokens')
  })
})
