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
    (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      ReactActual.createElement('input', props),
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
        value: Array.isArray(value) ? (value[0] ?? '') : (value ?? ''),
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) => onChange?.(event.target.value),
      },
      (options ?? []).map((option) =>
        ReactActual.createElement(
          'option',
          { key: option.value, value: option.value },
          option.label,
        ),
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
    window.localStorage.clear()
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

  it('renders task-first defaults with a clear title and sticky save action', async () => {
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
    expect(container.textContent).toContain('画布默认设置')
    expect(container.textContent).toContain('文本处理')
    expect(container.textContent).toContain('图片理解')
    expect(container.textContent).toContain('图片生成')
    expect(container.textContent).toContain('视频生成')
    expect(container.querySelectorAll('.canvas-preset-task-card')).toHaveLength(4)

    const closeButton =
      container.querySelector<HTMLButtonElement>('[aria-label="关闭画布默认设置"]')
    expect(closeButton).not.toBeNull()
    act(() => {
      closeButton?.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps detailed model and parameter controls behind node overrides', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<CanvasOperationPresetModal open onClose={vi.fn()} />)
    })

    const overrideTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('按节点覆盖'),
    )
    expect(overrideTab).not.toBeUndefined()
    await act(async () => overrideTab?.click())

    const mediaTarget = container.querySelector<HTMLButtonElement>(
      '[data-preset-target="text_to_image"]',
    )
    expect(mediaTarget).not.toBeUndefined()
    await act(async () => mediaTarget?.click())

    expect(container.querySelector('.canvas-operation-parameter-controls-stub')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-preset-param-grid')).toBeNull()
  })

  it('does not turn inherited node values into overrides when a task default changes', async () => {
    window.localStorage.setItem(
      'spark-canvas:task-defaults:v1',
      JSON.stringify({
        text: {
          agentId: 'agent:writer',
          providerProfileId: 'provider:text',
          modelId: 'gpt-5',
          skillIds: [],
        },
      }),
    )

    await act(async () => {
      root = createRoot(container)
      root.render(<CanvasOperationPresetModal open onClose={vi.fn()} />)
    })

    const directModel = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '直接用模型',
    )
    await act(async () => directModel?.click())
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '保存默认设置',
    )
    await act(async () => save?.click())

    const storedNodeOverrides = JSON.parse(
      window.localStorage.getItem('spark-canvas:operation-presets:v1') ?? '{}',
    ) as Record<string, unknown>
    expect(storedNodeOverrides).toEqual({})
  })

  it('preserves unavailable saved runtime values when node overrides are viewed but not edited', async () => {
    const storedOverride = {
      prompt: '保留节点提示词',
      agentId: 'agent:offline',
      providerProfileId: 'provider:offline',
      modelId: 'model:offline',
      skillIds: ['skill:offline'],
    }
    window.localStorage.setItem(
      'spark-canvas:operation-presets:v1',
      JSON.stringify({ text_generate: storedOverride }),
    )

    await act(async () => {
      root = createRoot(container)
      root.render(<CanvasOperationPresetModal open onClose={vi.fn()} />)
    })

    const overrideTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('按节点覆盖'),
    )
    await act(async () => overrideTab?.click())
    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '保存默认设置',
    )
    await act(async () => save?.click())

    const storedNodeOverrides = JSON.parse(
      window.localStorage.getItem('spark-canvas:operation-presets:v1') ?? '{}',
    ) as Record<string, unknown>
    expect(storedNodeOverrides.text_generate).toMatchObject(storedOverride)
  })

  it('preserves unavailable runtime values when only the node prompt is edited', async () => {
    const storedOverride = {
      prompt: '原节点提示词',
      agentId: 'agent:offline',
      providerProfileId: 'provider:offline',
      modelId: 'model:offline',
      skillIds: ['skill:offline'],
    }
    window.localStorage.setItem(
      'spark-canvas:operation-presets:v1',
      JSON.stringify({ text_generate: storedOverride }),
    )

    await act(async () => {
      root = createRoot(container)
      root.render(<CanvasOperationPresetModal open onClose={vi.fn()} />)
    })

    const overrideTab = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.includes('按节点覆盖'),
    )
    await act(async () => overrideTab?.click())

    const promptInput = Array.from(
      container.querySelectorAll<HTMLTextAreaElement>('textarea'),
    ).find((input) => input.value === storedOverride.prompt)
    expect(promptInput).not.toBeUndefined()
    await act(async () => {
      if (!promptInput) return
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        promptInput,
        '更新后的节点提示词',
      )
      promptInput.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const save = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === '保存默认设置',
    )
    await act(async () => save?.click())

    const storedNodeOverrides = JSON.parse(
      window.localStorage.getItem('spark-canvas:operation-presets:v1') ?? '{}',
    ) as Record<string, Record<string, unknown>>
    expect(storedNodeOverrides.text_generate).toMatchObject({
      ...storedOverride,
      prompt: '更新后的节点提示词',
    })
  })
})
