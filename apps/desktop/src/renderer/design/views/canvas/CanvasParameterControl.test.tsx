// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CanvasParameterControl } from './CanvasParameterControl'
import { presentField, type SchemaField } from './canvasParameterPresentation'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
    ReactActual.createElement('input', props)
  const AutoComplete = ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string
    onChange?: (value: string) => void
    placeholder?: string
  }) =>
    ReactActual.createElement('input', {
      value: value ?? '',
      placeholder,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.value),
    })
  const Select = ({
    value,
    options,
    onChange,
  }: {
    value?: string
    options?: Array<{ value: string; label: string }>
    onChange?: (value: string) => void
  }) =>
    ReactActual.createElement(
      'select',
      {
        value: value ?? '',
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange?.(event.target.value),
      },
      ReactActual.createElement('option', { value: '' }, '默认'),
      ...(options ?? []).map((option) =>
        ReactActual.createElement(
          'option',
          { key: option.value, value: option.value },
          option.label,
        ),
      ),
    )
  const Switch = ({
    checked,
    onChange,
  }: {
    checked?: boolean
    onChange?: (checked: boolean) => void
  }) =>
    ReactActual.createElement('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': checked,
      onClick: () => onChange?.(!checked),
    })
  const Slider = ({
    value,
    min,
    max,
    onChange,
  }: {
    value?: number
    min?: number
    max?: number
    onChange?: (value: number) => void
  }) =>
    ReactActual.createElement('input', {
      type: 'range',
      role: 'slider',
      value: value ?? min ?? 0,
      min,
      max,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        onChange?.(Number(event.target.value)),
    })
  return { AutoComplete, Input, Select, Slider, Switch }
})

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

function field(
  name: string,
  enumValues: string[] = [],
  type = 'string',
  extra: Partial<SchemaField> = {},
): SchemaField {
  return { name, title: name, type, enumValues, ...extra }
}

async function renderControl(schemaField: SchemaField, value: string, onChange = vi.fn()) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () =>
    root.render(
      <CanvasParameterControl
        presentation={presentField(schemaField)}
        value={value}
        onChange={onChange}
      />,
    ),
  )
  return { container, onChange }
}

describe('CanvasParameterControl', () => {
  it('renders aspect thumbnails and selects a ratio', async () => {
    const { container, onChange } = await renderControl(
      field('aspect_ratio', ['1:1', '16:9', '9:16']),
      '1:1',
    )
    const option = container.querySelector<HTMLButtonElement>('[data-param-value="16:9"]')!
    expect(option.querySelector('[data-aspect-width="32"][data-aspect-height="18"]')).not.toBeNull()
    await act(async () => option.click())
    expect(onChange).toHaveBeenCalledWith('16:9')
  })

  it('uses compact pressed buttons for resolution, count, and duration', async () => {
    const resolution = await renderControl(field('resolution', ['1K', '2K', '4K']), '2K')
    expect(
      resolution.container.querySelector('[data-param-value="2K"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
    const count = await renderControl(field('n', ['1', '2', '4']), '1')
    expect(count.container.textContent).toContain('2张')
    const duration = await renderControl(field('durationSeconds', ['5', '8']), '5')
    expect(duration.container.textContent).toContain('8秒')
  })

  it('renders bounded duration ranges as a slider with numeric readout', async () => {
    const { container, onChange } = await renderControl(
      field('duration', [], 'integer', { minimum: 2, maximum: 15 }),
      '5',
    )
    const slider = container.querySelector<HTMLInputElement>('[role="slider"]')

    expect(slider?.min).toBe('2')
    expect(slider?.max).toBe('15')
    expect(container.querySelector('.canvas-parameter-range-value')?.textContent).toContain('5秒')

    if (!slider) throw new Error('Expected duration slider')
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!valueSetter) throw new Error('Expected native slider value setter')
    await act(async () => {
      valueSetter.call(slider, '8')
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('8')
  })

  it('wraps long option lists into a three-column grid', async () => {
    const values = ['2K', '4K', '2048x2048', '2304x1728', '1728x2304', '2848x1600', '1600x2848']
    const { container } = await renderControl(field('resolution', values), '4K')
    const rail = container.querySelector('.canvas-parameter-option-rail')

    expect(rail).not.toBeNull()
    expect(rail?.querySelectorAll('[data-param-value]')).toHaveLength(values.length)
  })

  it('renders pixel-asterisk size (bailian qwen-image) as compact options, not aspect thumbnails', async () => {
    // 百炼 Qwen-Image 2.0 的 size 用像素星号（2048*2048），与 wan 的 1K/2K/4K、
    // 与 agnes 的 1024x1024 都不同。isRatioValue 正则只匹配 ':' 或 'x'/'×'，
    // 不匹配 '*'，因此星号格式必须落到 resolution（CompactOptions 按钮横排），
    // 不能被误判为 aspect-ratio 缩略图，否则画布会渲染出错误的比例预览。
    const values = ['2048*2048', '2688*1536', '1536*2688', '2368*1728', '1728*2368']
    const { container } = await renderControl(field('size', values), '2048*2048')
    const rail = container.querySelector('.canvas-parameter-option-rail')

    expect(rail).not.toBeNull()
    expect(rail?.querySelectorAll('[data-param-value]')).toHaveLength(values.length)
    // 星号格式不得渲染为比例缩略图（aspect-ratio 控件才有 data-aspect-width）
    expect(rail?.querySelector('[data-aspect-width]')).toBeNull()
    expect(
      rail?.querySelector('[data-param-value="2048*2048"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
  })

  it('renders common booleans as explicit enabled and disabled choices', async () => {
    const { container, onChange } = await renderControl(
      field('generate_audio', [], 'boolean'),
      'false',
    )
    expect(
      container.querySelector('[data-param-value="false"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-param-value="true"]')!.click(),
    )
    expect(onChange).toHaveBeenCalledWith('true')
  })

  it('supports custom enum input and numeric fallback', async () => {
    const custom = await renderControl(
      field('size', ['1:1', '16:9'], 'string', { allowCustom: true }),
      '16:9',
    )
    expect(custom.container.querySelector('input')).not.toBeNull()

    const numeric = await renderControl(field('seed', [], 'integer'), '12')
    expect(numeric.container.querySelector('input')?.type).toBe('number')
  })

  it('keeps only declared ratio options and previews a custom ratio', async () => {
    const { container } = await renderControl(
      field('aspectRatio', ['16:9'], 'string', { allowCustom: true }),
      '5:7',
    )

    expect(container.querySelectorAll('.canvas-aspect-ratio-option')).toHaveLength(1)
    expect(container.querySelector('[data-param-value="16:9"]')).not.toBeNull()
    expect(container.querySelector('input')).not.toBeNull()
    expect(
      container.querySelector(
        '[data-aspect-custom-preview="true"][data-aspect-width="23"][data-aspect-height="32"]',
      ),
    ).not.toBeNull()
  })

  it('separates mixed custom sizes into resolution buttons and shaped dimensions', async () => {
    const { container } = await renderControl(
      field('size', ['1K', '1024x1024', '1536x1024'], 'string', { allowCustom: true }),
      '1024x1024',
    )

    expect(container.querySelector('[data-param-value="1K"]')).not.toBeNull()
    expect(
      container.querySelector('[data-param-value="1536x1024"] [data-aspect-width="32"]'),
    ).not.toBeNull()
    expect(container.querySelector('input')).not.toBeNull()
  })

  it('renders OpenAI-style example sizes as choices and keeps custom input available', async () => {
    const { container, onChange } = await renderControl(
      field('size', ['auto', '1024x1024', '1536x1024', '1024x1536'], 'string', {
        allowCustom: true,
        pattern: '^(?:auto|\\d+\\s*[xX]\\s*\\d+)$',
      }),
      'auto',
    )

    expect(container.querySelector('[data-param-value="1536x1024"]')).not.toBeNull()
    expect(container.querySelector('input')).not.toBeNull()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-param-value="1024x1536"]')!.click(),
    )
    expect(onChange).toHaveBeenCalledWith('1024x1536')
  })

  it('renders Bailian custom pixel sizes alongside resolution presets', async () => {
    const { container } = await renderControl(
      field('size', ['1K', '2K', '2048*2048', '2048*1152'], 'string', {
        allowCustom: true,
        pattern: '^\\d+\\s*\\*\\s*\\d+$',
        enumLabels: { '2048*1152': '16:9' },
      }),
      '2K',
    )

    expect(container.querySelector('[data-param-value="2K"]')).not.toBeNull()
    const landscape = container.querySelector<HTMLButtonElement>('[data-param-value="2048*1152"]')
    expect(landscape).not.toBeNull()
    expect(landscape?.textContent).toContain('16:9')
    expect(container.querySelector('input')).not.toBeNull()
  })

  it('renders enumLabels as option labels for opaque enum values', async () => {
    // MiniMax 视频 Agent 的 templateId 是不透明数字 id，manifest 通过
    // x-template-labels 注入中文名；下拉应显示中文名而非裸 id。
    const { container } = await renderControl(
      field('templateId', ['392753057216684038', '398574688191234048'], 'string', {
        enumLabels: {
          '392753057216684038': '跳水',
          '398574688191234048': '四季写真',
        },
      }),
      '392753057216684038',
    )
    const options = container.querySelectorAll('option')
    const labels = Array.from(options).map((option) => option.textContent ?? '')
    expect(labels).toContain('跳水')
    expect(labels).toContain('四季写真')
    // 不应把裸 id 当标签回退显示
    expect(labels.some((label) => label.includes('392753057216684038'))).toBe(false)
  })
})
