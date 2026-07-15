// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { CanvasOperationParameterControls } from './CanvasOperationParameterControls'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) =>
      ReactActual.createElement('button', { type: 'button', ...props }, icon, children),
    Tooltip: ({ children }: { children: React.ReactNode }) => children,
  }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    AutoComplete: (props: React.InputHTMLAttributes<HTMLInputElement>) => ReactActual.createElement('input', props),
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => ReactActual.createElement('input', props),
    Select: (props: { value?: string; options?: Array<{ value: string; label: React.ReactNode }>; onChange?: (value: string) => void }) =>
      ReactActual.createElement('select', { value: props.value ?? '', onChange: (event: React.ChangeEvent<HTMLSelectElement>) => props.onChange?.(event.target.value) },
        ReactActual.createElement('option', { value: '' }, '默认'),
        ...(props.options ?? []).map((option) => ReactActual.createElement('option', { key: option.value, value: option.value }, option.label))),
    Switch: ({ checked, onChange }: { checked?: boolean; onChange?: (checked: boolean) => void }) =>
      ReactActual.createElement('button', { type: 'button', role: 'switch', 'aria-checked': checked, onClick: () => onChange?.(!checked) }),
    Popover: ({ content, children, open, onOpenChange, overlayClassName }: { content?: React.ReactNode; children?: React.ReactElement; open?: boolean; onOpenChange?: (open: boolean) => void; overlayClassName?: string }) =>
      ReactActual.createElement('div', { className: overlayClassName },
        ReactActual.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, { onClick: () => onOpenChange?.(!open) }),
        open ? content : null),
    Spin: () => ReactActual.createElement('span', null, '加载中'),
    Tooltip: ({ children }: { children: React.ReactNode }) => children,
  }
})

vi.mock('../../components/ProviderLogo', () => ({
  ProviderLogo: ({ title }: { title?: string }) => <span>{title}</span>,
  getProviderIconForVendor: (id: string) => ({ id, style: 'avatar' }),
}))

vi.mock('../../Icons', () => ({ Icons: new Proxy({}, { get: () => () => null }) }))

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

function model(): CanvasMediaModelSummary {
  return {
    manifestId: 'google:imagen',
    providerKind: 'apimart',
    providerProfileId: 'apimart-1',
    providerName: 'APIMart',
    modelId: 'imagen',
    effectiveModelId: 'imagen',
    displayName: 'Imagen',
    domains: ['image'],
    invocationMode: 'sync',
    capabilities: [],
    sourceUrls: [],
    enabled: true,
  }
}

describe('CanvasOperationParameterControls', () => {
  it('keeps common visual controls visible and folds advanced controls behind one button', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => root.render(
      <CanvasOperationParameterControls
        variant="toolbar"
        models={[model()]}
        modelValue=""
        fields={[
          { name: 'aspect_ratio', title: '画幅', type: 'string', enumValues: ['1:1', '16:9'] },
          { name: 'resolution', title: '分辨率', type: 'string', enumValues: ['1K', '2K'] },
          { name: 'seed', title: '随机种子', type: 'integer', enumValues: [] },
        ]}
        values={{ aspect_ratio: '1:1', resolution: '1K', seed: '' }}
        onModelChange={vi.fn()}
        onParameterChange={vi.fn()}
      />,
    ))

    expect(container.querySelector('[aria-label="选择模型"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="设置画幅"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="设置分辨率"]')).not.toBeNull()
    expect(container.querySelector('[data-parameter-name="seed"]')).toBeNull()

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="高级设置"]')!.click())
    expect(container.querySelector('[data-parameter-name="seed"]')).not.toBeNull()
  })

  it('can reuse the unified parameter layout when the model is selected by another runtime picker', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => root.render(
      <CanvasOperationParameterControls
        variant="panel"
        models={[]}
        modelValue=""
        showModelPicker={false}
        fields={[
          { name: 'aspect_ratio', title: '画幅', type: 'string', enumValues: ['1:1', '16:9'] },
        ]}
        values={{ aspect_ratio: '16:9' }}
        onModelChange={vi.fn()}
        onParameterChange={vi.fn()}
      />,
    ))

    expect(container.querySelector('[aria-label="选择模型"]')).toBeNull()
    expect(container.querySelector('[data-parameter-name="aspect_ratio"]')).not.toBeNull()
  })

  it('marks the aspect ratio popover for its multi-column layout', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => root.render(
      <CanvasOperationParameterControls
        variant="toolbar"
        models={[]}
        modelValue=""
        fields={[{ name: 'aspect_ratio', title: '鐢诲箙', type: 'string', enumValues: ['1:1', '16:9'] }]}
        values={{ aspect_ratio: '16:9' }}
        onModelChange={vi.fn()}
        onParameterChange={vi.fn()}
      />,
    ))

    await act(async () =>
      container.querySelector<HTMLButtonElement>('.canvas-operation-parameter-summary')!.click(),
    )
    expect(
      container.querySelector('.canvas-operation-parameter-overlay.is-aspect-ratio'),
    ).not.toBeNull()
  })
})
