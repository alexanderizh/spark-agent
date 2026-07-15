// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasOperationPresetModal } from './CanvasOperationPresetModal'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      icon,
      onClick,
      className,
      disabled,
      loading,
      ...rest
    }: {
      children: React.ReactNode
      icon?: React.ReactNode
      onClick?: () => void
      className?: string
      disabled?: boolean
      loading?: boolean
      [key: string]: unknown
    }) =>
      ReactActual.createElement(
        'button',
        { type: 'button', onClick, className, disabled: disabled || loading, ...rest },
        icon,
        children,
      ),
  }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Modal = ({
    open,
    title,
    children,
  }: {
    open?: boolean
    title?: React.ReactNode
    children?: React.ReactNode
  }) =>
    open
      ? ReactActual.createElement(
          'div',
          { className: 'ant-modal' },
          ReactActual.createElement('div', { className: 'ant-modal-title' }, title),
          children,
        )
      : null

  const Input = Object.assign(
    (props: React.InputHTMLAttributes<HTMLInputElement>) => ReactActual.createElement('input', props),
    {
      TextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) =>
        ReactActual.createElement('textarea', props),
    },
  )

  const Select = ({
    value,
    options,
    onChange,
    className,
  }: {
    value?: string | string[]
    options?: Array<{ value: string; label: string }>
    onChange?: (value: string) => void
    className?: string
  }) =>
    ReactActual.createElement(
      'select',
      {
        className,
        value: Array.isArray(value) ? value[0] ?? '' : (value ?? ''),
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange?.(event.target.value),
      },
      (options ?? []).map((option) =>
        ReactActual.createElement('option', { key: option.value, value: option.value }, option.label),
      ),
    )

  const Tag = ({ children }: { children?: React.ReactNode }) =>
    ReactActual.createElement('span', { className: 'ant-tag' }, children)

  return {
    Input,
    Modal,
    Select,
    Tag,
    message: { success: vi.fn(), error: vi.fn() },
  }
})

vi.mock('./CanvasAgentModal', () => ({
  AgentPickerInline: () => React.createElement('div', { className: 'agent-picker-stub' }, 'Agent'),
  ProviderModelPickerInline: () =>
    React.createElement('div', { className: 'provider-picker-stub' }, 'Provider'),
}))

vi.mock('./CanvasModelPicker', () => ({
  CanvasModelPicker: () =>
    React.createElement('div', { className: 'canvas-model-picker-stub' }, 'Media model picker'),
}))

vi.mock('./CanvasOperationParameterControls', () => ({
  CanvasOperationParameterControls: () =>
    React.createElement(
      'div',
      { className: 'canvas-operation-parameter-controls-stub' },
      'Unified parameters',
    ),
}))

vi.mock('./canvas.api', () => ({
  canvasApi: {
    listMediaModels: vi.fn().mockResolvedValue({ models: [] }),
  },
  operationLabel: (operation: string) => operation,
}))

describe('CanvasOperationPresetModal', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    const spark = {
      invoke: vi.fn().mockImplementation((channel: string) => {
        if (channel === 'agent:list') return Promise.resolve({ agents: [] })
        if (channel === 'provider:list') return Promise.resolve({ profiles: [] })
        if (channel === 'skill:list') return Promise.resolve({ skills: [] })
        return Promise.resolve({})
      }),
      on: vi.fn(),
      platform: 'darwin',
    }
    Object.defineProperty(window, 'spark', { configurable: true, value: spark })
  })

  afterEach(() => {
    if (root) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.body.innerHTML = ''
  })

  it('renders a dedicated scroll body, topbar close, and sticky footer actions', async () => {
    const onClose = vi.fn()

    await act(async () => {
      root = createRoot(container)
      root.render(<CanvasOperationPresetModal open onClose={onClose} />)
    })

    expect(container.querySelector('.canvas-operation-preset-topbar')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-preset-modal-shell')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-preset-scroll')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-preset-footer')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-preset-footer button')).not.toBeNull()

    const closeButton = container.querySelector<HTMLButtonElement>('[aria-label="关闭预设中心"]')
    expect(closeButton).not.toBeNull()
    act(() => {
      closeButton?.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('uses the hierarchical model picker and unified parameter controls for media presets', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<CanvasOperationPresetModal open onClose={vi.fn()} />)
    })

    const mediaTarget = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-operation-preset-sidebar-item'),
    ).find((button) => button.textContent?.includes('text_to_image'))

    expect(mediaTarget).not.toBeUndefined()
    await act(async () => mediaTarget?.click())

    expect(container.querySelector('.canvas-model-picker-stub')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-parameter-controls-stub')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-preset-param-grid')).toBeNull()
  })
})
