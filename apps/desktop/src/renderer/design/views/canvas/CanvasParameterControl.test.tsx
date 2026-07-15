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
  const AutoComplete = ({ value, onChange, placeholder }: { value?: string; onChange?: (value: string) => void; placeholder?: string }) =>
    ReactActual.createElement('input', {
      value: value ?? '',
      placeholder,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange?.(event.target.value),
    })
  const Select = ({ value, options, onChange }: { value?: string; options?: Array<{ value: string; label: string }>; onChange?: (value: string) => void }) =>
    ReactActual.createElement(
      'select',
      { value: value ?? '', onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange?.(event.target.value) },
      ReactActual.createElement('option', { value: '' }, '默认'),
      ...(options ?? []).map((option) => ReactActual.createElement('option', { key: option.value, value: option.value }, option.label)),
    )
  const Switch = ({ checked, onChange }: { checked?: boolean; onChange?: (checked: boolean) => void }) =>
    ReactActual.createElement('button', { type: 'button', role: 'switch', 'aria-checked': checked, onClick: () => onChange?.(!checked) })
  return { AutoComplete, Input, Select, Switch }
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

async function renderControl(
  schemaField: SchemaField,
  value: string,
  onChange = vi.fn(),
) {
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
    expect(resolution.container.querySelector('[data-param-value="2K"]')?.getAttribute('aria-pressed')).toBe('true')
    const count = await renderControl(field('n', ['1', '2', '4']), '1')
    expect(count.container.textContent).toContain('2张')
    const duration = await renderControl(field('durationSeconds', ['5', '8']), '5')
    expect(duration.container.textContent).toContain('8秒')
  })

  it('wraps long option lists into a three-column grid', async () => {
    const values = ['2K', '4K', '2048x2048', '2304x1728', '1728x2304', '2848x1600', '1600x2848']
    const { container } = await renderControl(field('resolution', values), '4K')
    const rail = container.querySelector('.canvas-parameter-option-rail')

    expect(rail).not.toBeNull()
    expect(rail?.querySelectorAll('[data-param-value]')).toHaveLength(values.length)
  })

  it('emits string boolean values', async () => {
    const { container, onChange } = await renderControl(field('searchEnabled', [], 'boolean'), 'false')
    await act(async () => container.querySelector<HTMLButtonElement>('[role="switch"]')!.click())
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
})
