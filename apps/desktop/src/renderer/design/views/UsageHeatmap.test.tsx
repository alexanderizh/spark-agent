// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageHeatmap } from './UsageHeatmap'

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
  vi.restoreAllMocks()
})

describe('UsageHeatmap', () => {
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

    expect(invoke).toHaveBeenCalledWith('usage:get-by-date-range', expect.any(Object))
    expect(container.textContent).toContain('1.2K tokens')
    expect(container.querySelector('[aria-label*="次请求"]')).not.toBeNull()
    expect(container.querySelector('[title*="1.2K tokens"]')).not.toBeNull()
  })
})
