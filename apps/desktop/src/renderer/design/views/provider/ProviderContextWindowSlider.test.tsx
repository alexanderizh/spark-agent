// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ProviderContextWindowSlider,
  formatContextWindowTokens,
} from './ProviderContextWindowSlider'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', () => ({
  Input: ({
    value,
    onChange,
    ...props
  }: {
    value?: string
    onChange?: (event: { target: { value: string } }) => void
    [key: string]: unknown
  }) => (
    <input
      type="number"
      value={value ?? ''}
      onChange={(event) => onChange?.({ target: { value: event.target.value } })}
      {...props}
    />
  ),
}))

/** jsdom 没有布局：把轨道 rect 固定为 left=0 / width=200 便于按 clientX 推算比例 */
const TRACK_RECT = { left: 0, top: 0, right: 200, bottom: 22, width: 200, height: 22, x: 0, y: 0 }

function pointerEvent(type: string, clientX: number): MouseEvent {
  return new MouseEvent(type, { clientX, bubbles: true, cancelable: true })
}

function setupHarness(props?: Partial<Parameters<typeof ProviderContextWindowSlider>[0]>) {
  const onChange = vi.fn()
  const onIsCustomChange = vi.fn()
  function Harness() {
    const [value, setValue] = React.useState(props?.value ?? 256_000)
    const [isCustom, setIsCustom] = React.useState(props?.isCustom ?? false)
    return (
      <ProviderContextWindowSlider
        value={value}
        supportsMillionContext={props?.supportsMillionContext ?? false}
        isCustom={isCustom}
        disabled={props?.disabled ?? false}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
        onIsCustomChange={(next) => {
          setIsCustom(next)
          onIsCustomChange(next)
        }}
      />
    )
  }
  return { onChange, onIsCustomChange, Harness }
}

describe('ProviderContextWindowSlider', () => {
  let container: HTMLDivElement
  let root: Root
  let rectSpy: ReturnType<typeof vi.spyOn>
  let setPointerCapture: ReturnType<typeof vi.fn>
  let hasPointerCapture: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      TRACK_RECT as DOMRect,
    )
    setPointerCapture = vi.fn()
    hasPointerCapture = vi.fn(() => false)
    Element.prototype.setPointerCapture = setPointerCapture as unknown as typeof Element.prototype.setPointerCapture
    Element.prototype.hasPointerCapture = hasPointerCapture as unknown as typeof Element.prototype.hasPointerCapture
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

  const track = () => container.querySelector<HTMLDivElement>('.pv_cw_track')

  it('renders pill track, ruler labels and the preset value', async () => {
    const { Harness } = setupHarness({ value: 400_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    expect(track()).not.toBeNull()
    expect(track()?.getAttribute('role')).toBe('slider')
    expect(track()?.getAttribute('aria-valuenow')).toBe('400000')
    expect(container.querySelector('.pv_cw_value')?.textContent).toBe('400K')
    const labels = Array.from(container.querySelectorAll('.pv_cw_scale_label')).map(
      (node) => node.textContent,
    )
    expect(labels).toEqual(['200K', '400K', '1M'])
    // 均匀细刻度尺：每 5% 一格共 21 条
    expect(container.querySelectorAll('.pv_cw_tick')).toHaveLength(21)
    // 当前值等于预设时对应标签高亮
    expect(
      Array.from(container.querySelectorAll('.pv_cw_scale_label')).some((node) =>
        node.classList.contains('is-active'),
      ),
    ).toBe(true)
  })

  it('shows the runtime fallback and dims the track in default mode', async () => {
    const { Harness } = setupHarness({ value: 0 })
    await act(async () => {
      root.render(<Harness />)
    })

    expect(container.querySelector('.pv_cw_value')?.textContent).toBe('默认（256K）')
    // 手柄停在 256K 的对数位置
    expect(track()?.getAttribute('aria-valuenow')).toBe('256000')
    expect(track()?.classList.contains('is-default')).toBe(true)

    // 旧数据兼容：只开过 1M 开关时默认回落展示 1M
    const million = setupHarness({ value: 0, supportsMillionContext: true })
    await act(async () => {
      root.render(<million.Harness />)
    })
    expect(container.querySelector('.pv_cw_value')?.textContent).toBe('默认（1M）')
    expect(track()?.getAttribute('aria-valuenow')).toBe('1000000')
  })

  it('emits a snapped value on pointer down (magnet near presets)', async () => {
    const { Harness, onChange } = setupHarness({ value: 256_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    // 43% 处的原始值 ≈399.6K，磁性吸附到 400K 预设
    await act(async () => {
      track()?.dispatchEvent(pointerEvent('pointerdown', 86))
    })
    expect(onChange).toHaveBeenLastCalledWith(400_000)

    // 50% 处 ≈447K，不在预设磁吸范围内 → 按_raw 1K 取整
    await act(async () => {
      track()?.dispatchEvent(pointerEvent('pointerdown', 100))
    })
    expect(onChange).toHaveBeenLastCalledWith(447_000)
  })

  it('emits continuously while dragging and stops on pointer up', async () => {
    const { Harness, onChange } = setupHarness({ value: 200_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      track()?.dispatchEvent(pointerEvent('pointerdown', 20))
    })
    await act(async () => {
      track()?.dispatchEvent(pointerEvent('pointermove', 120))
    })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(track()?.classList.contains('is-dragging')).toBe(true)

    await act(async () => {
      track()?.dispatchEvent(pointerEvent('pointerup', 120))
    })
    expect(track()?.classList.contains('is-dragging')).toBe(false)
  })

  it('moves by keyboard steps without magnet interference', async () => {
    const { Harness, onChange } = setupHarness({ value: 256_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    await act(async () => {
      track()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      )
    })
    // 键盘步进不做磁性吸附：256K + 4K = 260K
    expect(onChange).toHaveBeenLastCalledWith(260_000)

    await act(async () => {
      track()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
      )
    })
    expect(onChange).toHaveBeenLastCalledWith(1_000_000)
  })

  it('clamps out-of-range custom values for display and keeps the exact input value', async () => {
    const { Harness, onChange } = setupHarness({ value: 2_000_000, isCustom: true })
    await act(async () => {
      root.render(<Harness />)
    })

    // 范围外（>1M）：手柄夹在 1M 端点，自定义输入框显示精确值
    expect(track()?.getAttribute('aria-valuenow')).toBe('1000000')
    const input = container.querySelector<HTMLInputElement>('.pv_cw_input')
    expect(input?.value).toBe('2000000')

    // 输入超上限（20M）时按后端 zod .max 截断为 10M
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      nativeSetter?.call(input, '20000000')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith(10_000_000)
  })

  it('toggles custom mode and restores default through the action links', async () => {
    const { Harness, onChange, onIsCustomChange } = setupHarness({ value: 256_000 })
    await act(async () => {
      root.render(<Harness />)
    })

    const actionByName = (label: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('.pv_cw_action')).find(
        (node) => node.textContent === label,
      )

    // 自定义 → 进入输入模式（值保持不变）
    await act(async () => {
      actionByName('自定义')?.click()
    })
    expect(onIsCustomChange).toHaveBeenLastCalledWith(true)
    expect(container.querySelector('.pv_cw_input')).not.toBeNull()

    // 返回滑块 → 退出输入模式
    await act(async () => {
      actionByName('返回滑块')?.click()
    })
    expect(onIsCustomChange).toHaveBeenLastCalledWith(false)

    // 恢复默认 → 回写 0
    await act(async () => {
      actionByName('恢复默认')?.click()
    })
    expect(onChange).toHaveBeenLastCalledWith(0)
    expect(container.querySelector('.pv_cw_value')?.textContent).toBe('默认（256K）')
  })

  it('blocks interaction while disabled', async () => {
    const { Harness, onChange } = setupHarness({ value: 256_000, disabled: true })
    await act(async () => {
      root.render(<Harness />)
    })

    expect(container.querySelector('.pv_cw')?.classList.contains('is-disabled')).toBe(true)
    await act(async () => {
      track()?.dispatchEvent(pointerEvent('pointerdown', 100))
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('formatContextWindowTokens', () => {
  it('formats K and M values', () => {
    expect(formatContextWindowTokens(200_000)).toBe('200K')
    expect(formatContextWindowTokens(560_000)).toBe('560K')
    expect(formatContextWindowTokens(1_000_000)).toBe('1M')
    expect(formatContextWindowTokens(1_500_000)).toBe('1.5M')
    expect(formatContextWindowTokens(10_000_000)).toBe('10M')
  })
})
