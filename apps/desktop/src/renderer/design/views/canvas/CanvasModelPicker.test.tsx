// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { CanvasModelPicker } from './CanvasModelPicker'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      icon,
      onClick,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) =>
      ReactActual.createElement('button', { type: 'button', onClick, ...props }, icon, children),
    Tooltip: ({ children }: { children: React.ReactNode }) =>
      ReactActual.createElement('span', { 'data-tooltip-source': 'lobe' }, children),
  }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      ReactActual.createElement('input', props),
    Popover: ({
      open,
      content,
      children,
      onOpenChange,
      overlayClassName,
    }: {
      open?: boolean
      content?: React.ReactNode
      children?: React.ReactElement
      onOpenChange?: (open: boolean) => void
      overlayClassName?: string
    }) =>
      ReactActual.createElement(
        'div',
        { className: overlayClassName },
        ReactActual.cloneElement(children as React.ReactElement<{ onClick?: () => void }>, {
          onClick: () => onOpenChange?.(!open),
        }),
        open ? content : null,
      ),
    Spin: () => ReactActual.createElement('span', null, '加载中'),
    Tooltip: ({ children }: { children: React.ReactNode }) =>
      ReactActual.createElement('span', { 'data-tooltip-source': 'antd' }, children),
  }
})

vi.mock('../../components/ProviderLogo', () => ({
  ProviderLogo: ({ title, icon }: { title?: string; icon?: { id?: string } }) => (
    <span data-provider-logo data-provider-icon={icon?.id}>
      {title}
    </span>
  ),
  getProviderIconForVendor: (id: string) => ({ id, style: 'avatar' }),
}))

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

function model(input: Partial<CanvasMediaModelSummary>): CanvasMediaModelSummary {
  return {
    manifestId: input.manifestId ?? 'xai:grok-imagine-1',
    providerKind: input.providerKind ?? 'xai',
    modelId: input.modelId ?? 'grok-imagine-1',
    effectiveModelId: input.effectiveModelId ?? 'grok-imagine-1',
    displayName: input.displayName ?? 'Grok Imagine 1.0',
    domains: input.domains ?? ['image'],
    invocationMode: input.invocationMode ?? 'sync',
    capabilities: input.capabilities ?? [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['text'] },
        output: { types: ['image'] },
        paramSchema: {},
      },
    ],
    sourceUrls: [],
    enabled: true,
    ...(input.providerProfileId ? { providerProfileId: input.providerProfileId } : {}),
    ...(input.providerName ? { providerName: input.providerName } : {}),
    ...(input.providerIcon ? { providerIcon: input.providerIcon } : {}),
  }
}

async function renderPicker(props: React.ComponentProps<typeof CanvasModelPicker>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<CanvasModelPicker {...props} />))
  return container
}

describe('CanvasModelPicker', () => {
  const models = [
    model({ providerProfileId: 'apimart-1', providerName: 'APIMart', providerKind: 'apimart' }),
    model({
      providerProfileId: 'apimart-1',
      providerName: 'APIMart',
      providerKind: 'apimart',
      manifestId: 'google:veo-3',
      modelId: 'veo-3',
      effectiveModelId: 'veo-3',
      displayName: 'VEO3',
      domains: ['video'],
    }),
    model({ providerProfileId: 'xai-1', providerName: 'xAI 官方', providerKind: 'xai' }),
  ]

  it('navigates provider hierarchy, searches, and selects an independent model key', async () => {
    const onChange = vi.fn()
    const container = await renderPicker({ models, value: '', onChange })

    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!
    await act(async () => trigger.click())
    expect(container.querySelector('[role="listbox"]')).not.toBeNull()
    expect(container.querySelector('[data-provider-key="apimart-1"]')).not.toBeNull()

    const input = container.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, 'veo')
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: 'veo' }))
    })
    const option = container.querySelector<HTMLButtonElement>(
      '[data-model-key="apimart-1::google:veo-3::veo-3"]',
    )!
    expect(option).not.toBeNull()
    await act(async () => option.click())
    expect(onChange).toHaveBeenCalledWith('apimart-1::google:veo-3::veo-3')
  })

  it('closes the picker on Escape', async () => {
    const onChange = vi.fn()
    const container = await renderPicker({
      models,
      value: 'xai-1::xai:grok-imagine-1::grok-imagine-1',
      onChange,
    })
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!.click(),
    )
    const dialog = container.querySelector<HTMLElement>('.canvas-model-picker-popover')!
    await act(async () =>
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    )
    expect(container.querySelector('.canvas-model-picker-popover')).toBeNull()
  })

  it('shows a loading state without rendering the model list', async () => {
    const container = await renderPicker({
      models: [],
      value: '',
      loading: true,
      onChange: vi.fn(),
    })
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!.click(),
    )
    expect(container.textContent).toContain('加载中')
    expect(container.querySelector('[data-model-key]')).toBeNull()
  })

  it('uses a compact trigger and a visually isolated overlay inside task toolbars', async () => {
    const container = await renderPicker({
      models,
      value: '',
      compact: true,
      onChange: vi.fn(),
    })
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!
    expect(trigger.classList.contains('is-compact')).toBe(true)
    await act(async () => trigger.click())
    expect(container.querySelector('.canvas-model-picker-overlay')).not.toBeNull()
  })

  it('can clear an optional preset model without enabling auto routing in task panels', async () => {
    const onChange = vi.fn()
    const container = await renderPicker({
      models,
      value: 'xai-1::xai:grok-imagine-1::grok-imagine-1',
      allowEmpty: true,
      emptyLabel: '沿用平台默认',
      onChange,
    })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="选择模型"]')!.click(),
    )
    const emptyOption = container.querySelector<HTMLButtonElement>('[data-model-key="empty"]')
    expect(emptyOption?.textContent).toContain('沿用平台默认')
    await act(async () => emptyOption?.click())
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('uses the configured provider icon and does not render a model icon placeholder', async () => {
    const container = await renderPicker({
      models: [
        model({
          providerProfileId: 'custom-provider',
          providerName: 'Custom Provider',
          providerIcon: { id: 'openai', style: 'mono' },
        }),
      ],
      value: '',
      onChange: vi.fn(),
    })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('.canvas-model-picker-trigger')!.click(),
    )

    expect(
      container.querySelector(
        '[data-provider-key="custom-provider"] [data-provider-icon="openai"]',
      ),
    ).not.toBeNull()
    expect(container.querySelector('.canvas-model-picker-model-monogram')).toBeNull()
  })

  it('uses the popover library tooltip to avoid React 19 cross-library ref update loops', async () => {
    const container = await renderPicker({ models, value: '', onChange: vi.fn() })

    expect(container.querySelector('[data-tooltip-source="antd"]')).not.toBeNull()
    expect(container.querySelector('[data-tooltip-source="lobe"]')).toBeNull()
  })
})
