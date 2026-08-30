// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderModelScheduleSection } from './ProviderModelScheduleSection'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// antd Select 以原生 multiple select 模拟：change 事件带选中项数组。
vi.mock('antd', () => ({
  Select: ({
    value,
    options = [],
    onChange,
  }: {
    value?: string[]
    options?: Array<{ value: string; label: string }>
    onChange?: (value: string[]) => void
  }) => (
    <select
      multiple
      data-testid="model-select"
      defaultValue={value}
      onChange={(event) => {
        const selected = Array.from(event.target.selectedOptions).map((option) => option.value)
        onChange?.(selected)
      }}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Switch: () => <span data-testid="switch" />,
}))

describe('ProviderModelScheduleSection', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
  })

  function render(modelIds: string[], schedules: Parameters<typeof ProviderModelScheduleSection>[0]['schedules']) {
    const onChange = vi.fn()
    act(() => {
      root?.render(
        <ProviderModelScheduleSection modelIds={modelIds} schedules={schedules} onChange={onChange} />,
      )
    })
    return { onChange }
  }

  function clickDay(label: string) {
    const day = Array.from(container!.querySelectorAll('.pv_ms_day')).find(
      (b) => b.textContent === label,
    ) as HTMLButtonElement
    act(() => {
      day.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  const scheduleA = {
    modelId: 'model-a',
    enabled: true,
    days: [1],
    startMinute: 600,
    endMinute: 720,
  }

  it('窗口配置相同的多条 schedule 合并为一行展示', () => {
    render(['model-a', 'model-b', 'model-c'], [
      scheduleA,
      { ...scheduleA, modelId: 'model-b' },
      { ...scheduleA, modelId: 'model-c', days: [2] },
    ])
    expect(container!.querySelectorAll('.pv_ms_row')).toHaveLength(2)
    const firstSelect = container!.querySelectorAll(
      'select[data-testid="model-select"]',
    )[0] as HTMLSelectElement
    expect(Array.from(firstSelect.selectedOptions).map((o) => o.value)).toEqual([
      'model-a',
      'model-b',
    ])
  })

  it('行内模型多选新增模型后展开为逐条 schedule', () => {
    const { onChange } = render(['model-a', 'model-b', 'model-c'], [scheduleA])
    const select = container!.querySelector(
      'select[data-testid="model-select"]',
    ) as HTMLSelectElement | null
    expect(select).not.toBeNull()
    act(() => {
      Array.from(select!.options).forEach((option) => {
        option.selected = option.value === 'model-a' || option.value === 'model-b'
      })
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith([scheduleA, { ...scheduleA, modelId: 'model-b' }])
  })

  it('行内模型清空时删除整行', () => {
    const { onChange } = render(['model-a'], [scheduleA])
    const select = container!.querySelector(
      'select[data-testid="model-select"]',
    ) as HTMLSelectElement | null
    expect(select).not.toBeNull()
    act(() => {
      Array.from(select!.options).forEach((option) => {
        option.selected = false
      })
      select!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('行内修改日期对整组模型生效（多选）', () => {
    const { onChange } = render(
      ['model-a', 'model-b'],
      [scheduleA, { ...scheduleA, modelId: 'model-b' }],
    )
    clickDay('三')
    expect(onChange).toHaveBeenCalledWith([
      { ...scheduleA, days: [1, 3] },
      { ...scheduleA, modelId: 'model-b', days: [1, 3] },
    ])
  })

  it('点击删除按钮移除整行（含行内全部模型）', () => {
    const { onChange } = render(
      ['model-a', 'model-b'],
      [scheduleA, { ...scheduleA, modelId: 'model-b' }],
    )
    const remove = container!.querySelector('.pv_ms_remove') as HTMLButtonElement
    act(() => {
      remove.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith([])
  })
})
