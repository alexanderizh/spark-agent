// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createCanvasBatchTaskSession } from './canvasBatchTaskModel'
import { CanvasBatchTaskPanel } from './CanvasBatchTaskPanel'
import { canvasApi } from './canvas.api'
import type { CanvasBatchTaskState } from './useCanvasBatchTasks'
import type { CanvasNode } from './canvas.types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@lobehub/ui', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  return {
    Button: ({
      children,
      icon,
      loading,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      icon?: React.ReactNode
      loading?: boolean
    }) =>
      ReactActual.createElement(
        'button',
        { type: 'button', disabled: props.disabled || loading, ...props },
        icon,
        children,
      ),
  }
})

vi.mock('antd', async () => {
  const ReactActual = await vi.importActual<typeof import('react')>('react')
  const Input = Object.assign(
    ({
      allowClear: _allowClear,
      ...props
    }: React.InputHTMLAttributes<HTMLInputElement> & { allowClear?: boolean }) =>
      ReactActual.createElement('input', props),
    {
      Search: ({
        allowClear: _allowClear,
        ...props
      }: React.InputHTMLAttributes<HTMLInputElement> & { allowClear?: boolean }) =>
        ReactActual.createElement('input', props),
    },
  )
  return {
    Checkbox: ({
      checked,
      children,
      onChange,
    }: {
      checked?: boolean
      children?: React.ReactNode
      onChange?: (event: { target: { checked: boolean } }) => void
    }) =>
      ReactActual.createElement(
        'label',
        null,
        ReactActual.createElement('input', {
          type: 'checkbox',
          checked,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            onChange?.({ target: { checked: event.target.checked } }),
        }),
        children,
      ),
    Input,
    Modal: ({
      open,
      children,
      title,
    }: {
      open?: boolean
      children?: React.ReactNode
      title?: React.ReactNode
    }) =>
      open
        ? ReactActual.createElement(
            'div',
            { role: 'dialog' },
            ReactActual.createElement('h2', null, title),
            children,
          )
        : null,
    Spin: () => ReactActual.createElement('span', null, '加载中'),
    Tag: ({ children }: { children?: React.ReactNode }) =>
      ReactActual.createElement('span', null, children),
    message: { success: vi.fn(), error: vi.fn() },
  }
})

vi.mock('./CanvasModelPicker', () => ({
  CanvasModelPicker: ({ value }: { value?: string }) => (
    <div data-testid="model-picker" data-value={value}>
      模型选择器
    </div>
  ),
}))

vi.mock('./CanvasOperationParameterControls', () => ({
  CanvasOperationParameterControls: ({
    onParameterChange,
  }: {
    onParameterChange?: (name: string, value: string) => void
  }) => (
    <button type="button" onClick={() => onParameterChange?.('n', '3')}>
      修改生成数量
    </button>
  ),
}))

vi.mock('./canvas.api', () => ({
  canvasApi: {
    listMediaModels: vi.fn(async () => ({ models: [] })),
  },
  operationLabel: (operation: string) => operation,
}))

vi.mock('../../Icons', () => ({
  Icons: new Proxy({}, { get: () => () => null }),
}))

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

function operationNode(id: string, type: 'text_to_image' | 'text_to_video'): CanvasNode {
  return {
    id,
    projectId: 'project',
    boardId: 'board',
    userId: 1,
    type,
    title: id === 'node-1' ? '封面主图' : '短视频',
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 240,
    height: 160,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { modelId: `${id}-model`, modelParams: {} },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  }
}

function mediaModel(
  input: Partial<CanvasMediaModelSummary>,
): CanvasMediaModelSummary {
  return {
    manifestId: input.manifestId ?? 'vendor:image-model',
    providerKind: input.providerKind ?? 'vendor',
    modelId: input.modelId ?? 'image-model',
    effectiveModelId: input.effectiveModelId ?? 'image-model',
    displayName: input.displayName ?? 'Image Model',
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
  }
}

function state(mode: CanvasBatchTaskState['mode']): CanvasBatchTaskState {
  return {
    mode,
    session: createCanvasBatchTaskSession([
      operationNode('node-1', 'text_to_image'),
      operationNode('node-2', 'text_to_video'),
    ]),
    issues: [],
    validationWarnings: [],
    results: [],
    skipNextConfirmation: false,
    skipParameterValidation: false,
    saving: false,
  }
}

async function render(
  current: CanvasBatchTaskState,
  handlers: Partial<React.ComponentProps<typeof CanvasBatchTaskPanel>> = {},
) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  const props: React.ComponentProps<typeof CanvasBatchTaskPanel> = {
    state: current,
    onPatchGroup: vi.fn(),
    onPatchNode: vi.fn(),
    onSaveDrafts: vi.fn(async () => undefined),
    onSubmit: vi.fn(async () => undefined),
    onConfirmSubmit: vi.fn(async () => undefined),
    onRetryFailed: vi.fn(async () => undefined),
    onSkipNextConfirmationChange: vi.fn(),
    onSkipParameterValidationChange: vi.fn(),
    onBackToConfigure: vi.fn(),
    onClose: vi.fn(),
    ...handlers,
  }
  await act(async () => root.render(<CanvasBatchTaskPanel {...props} />))
  return {
    container,
    props,
    rerender: async (next: CanvasBatchTaskState) => {
      await act(async () => root.render(<CanvasBatchTaskPanel {...props} state={next} />))
    },
  }
}

describe('CanvasBatchTaskPanel', () => {
  it('uses application theme tokens instead of light-only fallback colors', () => {
    const batchTaskPanelStyles = readFileSync(
      resolve(
        process.cwd(),
        'src/renderer/design/views/canvas/CanvasBatchTaskPanel.less',
      ),
      'utf8',
    )
    expect(batchTaskPanelStyles).toContain('--batch-panel: var(--bg-sunken)')
    expect(batchTaskPanelStyles).toContain('--batch-muted: var(--text-muted)')
    expect(batchTaskPanelStyles).toContain('background: var(--panel)')
    expect(batchTaskPanelStyles).toContain('color: var(--success)')
    expect(batchTaskPanelStyles).not.toContain('--color-bg-container')
    expect(batchTaskPanelStyles).not.toContain('--color-text')
  })

  it('focuses the first invalid node in configuration mode', async () => {
    const current = state('configure')
    current.issues = [
      { nodeId: 'node-2', fieldPath: ['modelId'], message: '缺少模型' },
    ]

    const { container } = await render(current)

    const invalidRow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('短视频'),
    )
    expect(invalidRow?.getAttribute('aria-current')).toBe('true')
    expect(container.textContent).toContain('缺少模型')
  })

  it('moves focus to the first invalid node after validation', async () => {
    const current = state('configure')
    const { container, rerender } = await render(current)
    const firstNode = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('封面主图'),
    )!
    await act(async () => firstNode.click())

    const invalid = {
      ...current,
      issues: [{ nodeId: 'node-2', fieldPath: ['modelId'], message: '缺少模型' }],
      session: {
        ...current.session!,
        activeOperation: 'text_to_video' as const,
        activeNodeId: 'node-2',
      },
    }
    await rerender(invalid)

    const invalidRow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('短视频'),
    )
    expect(invalidRow?.getAttribute('aria-current')).toBe('true')
    expect(container.querySelector('.canvas-batch-task-editor h3')?.textContent).toBe('短视频')
  })

  it('keeps invalid nodes visible when they do not match the active search', async () => {
    const current = state('configure')
    const { container, rerender } = await render(current)
    const search = container.querySelector<HTMLInputElement>(
      'input[placeholder="搜索任务节点"]',
    )!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        search,
        '封面',
      )
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(
      Array.from(container.querySelectorAll('button')).some((button) =>
        button.textContent?.includes('短视频'),
      ),
    ).toBe(false)

    await rerender({
      ...current,
      issues: [{ nodeId: 'node-2', fieldPath: ['modelId'], message: '缺少模型' }],
      session: {
        ...current.session!,
        activeOperation: 'text_to_video',
        activeNodeId: 'node-2',
      },
    })

    const invalidRow = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('短视频'),
    )
    expect(invalidRow?.getAttribute('aria-current')).toBe('true')
  })

  it('keeps save draft separate from submit', async () => {
    const onSaveDrafts = vi.fn(async () => undefined)
    const onSubmit = vi.fn(async () => undefined)
    const { container } = await render(state('configure'), {
      onSaveDrafts,
      onSubmit,
    })

    const save = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '保存参数草稿',
    )!
    await act(async () => save.click())

    expect(onSaveDrafts).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not confirm when the user returns to edit', async () => {
    const onConfirmSubmit = vi.fn(async () => undefined)
    const onBackToConfigure = vi.fn()
    const onSkipNextConfirmationChange = vi.fn()
    const { container } = await render(state('confirm'), {
      onConfirmSubmit,
      onBackToConfigure,
      onSkipNextConfirmationChange,
    })

    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => checkbox.click())
    const back = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '返回修改',
    )!
    await act(async () => back.click())

    expect(onSkipNextConfirmationChange).toHaveBeenCalledWith(true)
    expect(onBackToConfigure).toHaveBeenCalledTimes(1)
    expect(onConfirmSubmit).not.toHaveBeenCalled()
  })

  it('converts schema parameter strings before patching task drafts', async () => {
    const onPatchGroup = vi.fn()
    const { container } = await render(state('configure'), { onPatchGroup })

    const changeCount = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '修改生成数量',
    )!
    await act(async () => changeCount.click())

    expect(onPatchGroup).toHaveBeenCalledWith('text_to_image', {
      touched: ['modelParams.n'],
      values: { modelParams: { n: 3 } },
    })
  })

  it('does not display the first available model as selected for mixed model values', async () => {
    vi.mocked(canvasApi.listMediaModels).mockResolvedValueOnce({
      models: [
        mediaModel({
          providerProfileId: 'provider-a',
          manifestId: 'vendor:model-a',
          modelId: 'model-a',
          effectiveModelId: 'model-a',
        }),
        mediaModel({
          providerProfileId: 'provider-b',
          manifestId: 'vendor:model-b',
          modelId: 'model-b',
          effectiveModelId: 'model-b',
        }),
      ],
    })
    const first = operationNode('node-1', 'text_to_image')
    first.data = {
      ...first.data,
      providerProfileId: 'provider-a',
      manifestId: 'vendor:model-a',
      modelId: 'model-a',
    }
    const second = operationNode('node-2', 'text_to_image')
    second.data = {
      ...second.data,
      providerProfileId: 'provider-b',
      manifestId: 'vendor:model-b',
      modelId: 'model-b',
    }
    const current = state('configure')
    current.session = createCanvasBatchTaskSession([first, second])

    const { container } = await render(current)
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="model-picker"]')).not.toBeNull(),
    )

    expect(
      container.querySelector('[data-testid="model-picker"]')?.getAttribute('data-value'),
    ).toBe('')
  })

  it('shows task titles instead of internal node ids in submission results', async () => {
    const current = state('result')
    current.results = [
      { nodeId: 'node-1', batchId: 'batch-1', status: 'succeeded' },
      {
        nodeId: 'node-2',
        batchId: 'batch-1',
        status: 'failed',
        error: 'network error',
      },
    ]

    const { container } = await render(current)

    expect(container.textContent).toContain('封面主图')
    expect(container.textContent).toContain('短视频')
    expect(container.textContent).not.toContain('node-1')
  })
})
