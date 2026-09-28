// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderModelContextWindowField } from './ProviderModelContextWindowField'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** jsdom 没有布局：把轨道 rect 固定为 left=0 / width=200 便于按 clientX 推算比例 */
const TRACK_RECT = { left: 0, top: 0, right: 200, bottom: 22, width: 200, height: 22, x: 0, y: 0 }

function pointerEvent(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { clientX, bubbles: true, cancelable: true })
}

interface HarnessProps {
  value?: number
  fallbackValue?: number
  disabled?: boolean
}

function setupHarness(props?: HarnessProps) {
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = React.useState(props?.value ?? 0)
    return (
      <ProviderModelContextWindowField
        value={value}
        fallbackValue={props?.fallbackValue ?? 256_000}
        disabled={props?.disabled ?? false}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }
  return { onChange, Harness }
}

describe('ProviderModelContextWindowField', () => {
  let container: HTMLDivElement
  let root: Root
  let rectSpy: ReturnType<typeof vi.spyOn>
  let setPointerCapture: ReturnType<typeof vi.fn>
  let hasPointerCapture: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(TRACK_RECT as DOMRect)
    setPointerCapture = vi.fn()
    hasPointerCapture = vi.fn(() => false)
    Element.prototype.setPointerCapture =
      setPointerCapture as unknown as typeof Element.prototype.setPointerCapture
    Element.prototype.hasPointerCapture =
      hasPointerCapture as unknown as typeof Element.prototype.hasPointerCapture
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    rectSpy.mockRestore()
    Reflect.deleteProperty(Element.prototype, 'setPointerCapture')
    Reflect.deleteProperty(Element.prototype, 'hasPointerCapture')
  })

  const track = () => container.querySelector<HTMLDivElement>('.pv_mcw_track')
  const slot = () => container.querySelector<HTMLDivElement>('.pv_mcw_slot')

  it('默认态：展示回落值、渲染与渠道级滑块的同款刻度尺', async () => {
    const { Harness } = setupHarness({ value: 0, fallbackValue: 256_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    expect(container.querySelector('.pv_mcw_value')?.textContent).toBe('默认 · 256K')
    expect(track()?.getAttribute('role')).toBe('slider')
    expect(track()?.getAttribute('aria-valuenow')).toBe('256000')
    expect(container.querySelector('.pv_mcw')?.classList.contains('is-default')).toBe(true)
    const labels = Array.from(container.querySelectorAll('.pv_mcw_scale_label')).map(
      (node) => node.textContent,
    )
    expect(labels).toEqual(['200K', '400K', '1M'])
    expect(container.querySelectorAll('.pv_mcw_tick')).toHaveLength(21)
    // 默认态不显示恢复默认按钮
    expect(container.querySelector('.pv_mcw_reset')).toBeNull()
  })

  it('已自定义态：值 + 恢复默认同处固定宽度槽内（不挤压轨道）', async () => {
    const { Harness, onChange } = setupHarness({ value: 913_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    expect(container.querySelector('.pv_mcw_value')?.textContent).toBe('913K')
    const reset = container.querySelector<HTMLButtonElement>('.pv_mcw_reset')
    expect(reset).not.toBeNull()
    // 结构不变式：值槽宽度固定，恢复默认按钮必须在该槽内，才可能不推动轨道
    expect(slot()?.contains(reset)).toBe(true)
    expect(container.querySelector('.pv_mcw_value')?.parentElement).toBe(slot())
    expect(container.querySelector('.pv_mcw_row')?.lastElementChild).toBe(slot())
    // 当前值命中预设时对应刻度标签高亮
    expect(
      Array.from(container.querySelectorAll('.pv_mcw_scale_label')).some((node) =>
        node.classList.contains('is-active'),
      ),
    ).toBe(false)

    await act(async () => {
      reset?.click()
    })
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('拖拽轨道写入吸附后的显式值（拖拽过程中槽位不变）', async () => {
    const { Harness, onChange } = setupHarness({ value: 256_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      track()?.dispatchEvent(pointerEvent('pointerdown', 86))
    })
    expect(onChange).toHaveBeenLastCalledWith(400_000)
    // 拖拽后仍是「已自定义」态：值槽结构不变，轨道几何不重排
    expect(container.querySelector('.pv_mcw_value')?.parentElement).toBe(slot())
  })

  it('键盘：方向键步进、Home/End 到端点、Delete 恢复默认', async () => {
    const { Harness, onChange } = setupHarness({ value: 256_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    const press = async (key: string) => {
      await act(async () => {
        track()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      })
    }

    await press('ArrowRight')
    expect(onChange).toHaveBeenLastCalledWith(260_000)
    await press('End')
    expect(onChange).toHaveBeenLastCalledWith(1_000_000)
    await press('Home')
    expect(onChange).toHaveBeenLastCalledWith(200_000)
    await press('Delete')
    expect(onChange).toHaveBeenLastCalledWith(0)
  })

  it('点击值切精确输入：回车提交、越界收敛到 10M、Esc 取消', async () => {
    const { Harness, onChange } = setupHarness({ value: 913_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    const openInput = async () => {
      await act(async () => {
        container.querySelector<HTMLButtonElement>('.pv_mcw_value')?.click()
      })
      return container.querySelector<HTMLInputElement>('.pv_mcw_input')
    }
    const typeAndCommit = async (input: HTMLInputElement, text: string, key = 'Enter') => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )?.set
        setter?.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      })
    }

    const input = await openInput()
    expect(input).not.toBeNull()
    if (input == null) throw new Error('input not found')
    await typeAndCommit(input, '524288')
    expect(onChange).toHaveBeenLastCalledWith(524_288)

    const overflow = await openInput()
    if (overflow == null) throw new Error('input not found')
    await typeAndCommit(overflow, '99999999')
    expect(onChange).toHaveBeenLastCalledWith(10_000_000)

    const escaped = await openInput()
    if (escaped == null) throw new Error('input not found')
    const calls = onChange.mock.calls.length
    await typeAndCommit(escaped, '123456', 'Escape')
    expect(onChange.mock.calls.length).toBe(calls)
  })
})
