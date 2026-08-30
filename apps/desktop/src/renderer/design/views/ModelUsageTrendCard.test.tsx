// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelUsageTrendCard } from './ModelUsageTrendCard'
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
        { 'data-testid': 'usage-trend-range' },
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

const setTweak = vi.fn()

vi.mock('../AppContext', async () => {
  const actual = await vi.importActual<typeof import('../AppContext')>('../AppContext')
  return {
    ...actual,
    useApp: () => ({ setTweak }),
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
  vi.restoreAllMocks()
  setTweak.mockReset()
})

function mountCard(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  act(() => root.render(<ModelUsageTrendCard />))
  return container
}

const todayKey = new Date().toISOString().slice(0, 10)

describe('ModelUsageTrendCard', () => {
  it('fetches 7d range and renders top model stacked bars with legend', async () => {
    const invoke = vi.fn().mockResolvedValue({
      modelDailyGroups: [
        {
          date: todayKey,
          modelId: 'GLM-5.3',
          providerId: 'zhipu',
          totalInputTokens: 900,
          totalOutputTokens: 90,
          totalReasoningOutputTokens: 10,
          totalCostUsd: 0,
          recordCount: 2,
        },
        {
          date: todayKey,
          modelId: 'GLM-5.2',
          providerId: 'zhipu',
          totalInputTokens: 300,
          totalOutputTokens: 100,
          totalReasoningOutputTokens: 0,
          totalCostUsd: 0,
          recordCount: 1,
        },
      ],
    })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mountCard()
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(invoke).toHaveBeenCalledWith('usage:get-by-date-range', {
      startDate: expect.stringMatching(/T00:00:00\.000Z$/),
      endDate: expect.stringMatching(/T23:59:59\.999Z$/),
    })
    const request = invoke.mock.calls[0]?.[1] as { startDate: string; endDate: string }
    expect(Date.parse(request.endDate) - Date.parse(request.startDate)).toBe(
      7 * 24 * 60 * 60 * 1000 - 1,
    )

    // 图例：消耗总量 + 两个模型（按总量降序）
    expect(container.textContent).toContain('模型用量趋势')
    expect(container.textContent).toContain('GLM-5.3')
    expect(container.textContent).toContain('GLM-5.2')
    expect(container.querySelectorAll('.usage-trend-swatch--c0')).not.toHaveLength(0)

    // 分组柱：同一天的两个模型各是一根独立细柱并排（非堆叠）
    const lastDayArea = [...container.querySelectorAll('.usage-trend-bar-area')].at(-1)
    expect(lastDayArea?.querySelectorAll('.usage-trend-bar')).toHaveLength(2)
    expect(lastDayArea?.querySelector('.usage-trend-swatch--c0')).not.toBeNull()
    expect(lastDayArea?.querySelector('.usage-trend-swatch--c1')).not.toBeNull()

    // 7 根日柱 + 每天都有刻度
    expect(container.querySelectorAll('.usage-trend-col')).toHaveLength(7)
    expect(container.querySelector('.usage-trend-tick')?.textContent).not.toBe('')

    // 右上角直达用量统计设置页
    const link = container.querySelector<HTMLButtonElement>('.usage-trend-link')
    expect(link?.textContent).toContain('用量统计')
    act(() => link?.click())
    expect(setTweak).toHaveBeenCalledWith('settingsSection', 'usage')
  })

  it('switches to 30d range and renders 30 day columns with 5-day ticks', async () => {
    const invoke = vi.fn().mockResolvedValue({
      modelDailyGroups: [
        {
          date: todayKey,
          modelId: 'GLM-5.3',
          providerId: 'zhipu',
          totalInputTokens: 900,
          totalOutputTokens: 90,
          totalReasoningOutputTokens: 10,
          totalCostUsd: 0,
          recordCount: 2,
        },
      ],
    })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mountCard()
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    expect(container.querySelectorAll('.usage-trend-col')).toHaveLength(7)

    const button30d = container.querySelector<HTMLButtonElement>(
      '[data-testid="usage-trend-range"] button:nth-child(2)',
    )
    expect(button30d?.textContent).toBe('近 30 日')
    await act(async () => button30d?.click())
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(container.textContent).toContain('消耗总量')
    expect(container.querySelectorAll('.usage-trend-col')).toHaveLength(30)
    expect(invoke).toHaveBeenCalledTimes(2)
    const second = invoke.mock.calls[1]?.[1] as { startDate: string; endDate: string }
    expect(Date.parse(second.endDate) - Date.parse(second.startDate)).toBe(
      30 * 24 * 60 * 60 * 1000 - 1,
    )
    // 30 天档每 5 天一个刻度：共 6 个非空刻度
    const ticks = [...container.querySelectorAll('.usage-trend-tick')]
    expect(ticks.filter((tick) => tick.textContent !== '')).toHaveLength(6)
  })

  it('shows an empty state when there are no records', async () => {
    const invoke = vi.fn().mockResolvedValue({ modelDailyGroups: [] })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mountCard()
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })

    expect(container.textContent).toContain('近 7 日暂无用量记录')
    expect(container.querySelectorAll('.usage-trend-col')).toHaveLength(0)
  })

  it('renders a retryable error state when the IPC call fails', async () => {
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(new Error('db locked'))
      .mockResolvedValueOnce({ modelDailyGroups: [] })
    ;(window as unknown as { spark: { invoke: typeof invoke } }).spark = { invoke }

    const container = mountCard()
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    expect(container.textContent).toContain('db locked')

    const retry = container.querySelector<HTMLButtonElement>('.usage-trend-error button')
    await act(async () => retry?.click())
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10))
    })
    expect(container.textContent).toContain('暂无用量记录')
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
