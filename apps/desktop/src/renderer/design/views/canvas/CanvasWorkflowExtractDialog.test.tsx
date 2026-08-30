// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasWorkflowExtractDialog } from './CanvasWorkflowExtractDialog'
import type { CanvasWorkflowDraft } from './canvasWorkflowExtraction'
import { canvasWorkflowApi } from './canvasWorkflow.api'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./canvasWorkflow.api', () => ({
  canvasWorkflowApi: { create: vi.fn(), update: vi.fn() },
}))

const draft: CanvasWorkflowDraft = {
  name: '生成镜头图',
  description: '由 3 个节点提取',
  tags: ['shot'],
  package: {
    schemaVersion: 1,
    graph: {
      nodes: [
        {
          id: 'input',
          kind: 'canvas_input',
          label: '分镜文本',
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: 'op',
          kind: 'canvas_operation',
          label: '生成图片',
          position: { x: 300, y: 0 },
          config: {},
        },
        {
          id: 'output',
          kind: 'canvas_output',
          label: '镜头图',
          position: { x: 600, y: 0 },
          config: {},
        },
      ],
      edges: [
        { id: 'e1', sourceNodeId: 'input', targetNodeId: 'op' },
        { id: 'e2', sourceNodeId: 'op', targetNodeId: 'output' },
      ],
    },
    contract: {
      inputs: [
        {
          id: 'input-input',
          name: '分镜文本',
          valueType: 'text',
          required: true,
          targetNodeId: 'input',
        },
      ],
      outputs: [
        { id: 'output-output', name: '镜头图', valueType: 'image', sourceNodeId: 'output' },
      ],
      exposedParams: [],
    },
    dependencies: {
      modelCapabilities: ['text_to_image'],
      canvasNodeKinds: ['text', 'text_to_image', 'image'],
    },
    provenance: {
      extractedFromProjectId: 'project-1',
      extractedFromCanvasId: 'board-1',
      sourceNodeIds: ['input', 'op', 'output'],
    },
  },
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function renderDialog(
  overrides: Partial<React.ComponentProps<typeof CanvasWorkflowExtractDialog>> = {},
) {
  const props: React.ComponentProps<typeof CanvasWorkflowExtractDialog> = {
    open: true,
    projectId: 'project-1',
    draft,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<CanvasWorkflowExtractDialog {...props} />))
  return { container, props }
}

beforeEach(() => {
  vi.mocked(canvasWorkflowApi.create).mockResolvedValue({
    id: 'saved-workflow',
    projectId: 'project-1',
    name: '镜头图工作流',
    description: draft.description,
    scope: 'project',
    status: 'draft',
    version: 1,
    tags: draft.tags,
    package: draft.package,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  })
  vi.mocked(canvasWorkflowApi.update).mockResolvedValue({
    id: 'existing-workflow',
    projectId: 'project-1',
    name: '镜头图工作流',
    description: draft.description,
    scope: 'project',
    status: 'draft',
    version: 2,
    tags: draft.tags,
    package: draft.package,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T01:00:00.000Z',
  })
})

afterEach(() => {
  vi.clearAllMocks()
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

describe('CanvasWorkflowExtractDialog', () => {
  it('shows rule-derived topology and editable contracts', async () => {
    const { container } = await renderDialog()
    expect(container.textContent).toContain('3 个来源节点')
    expect(container.textContent).toContain('2 条内部连线')
    expect(container.querySelector<HTMLInputElement>('[aria-label="输入名称 1"]')?.value).toBe(
      '分镜文本',
    )
    expect(container.querySelector<HTMLInputElement>('[aria-label="输出名称 1"]')?.value).toBe(
      '镜头图',
    )
  })

  it('saves the confirmed draft as a project workflow without mutating the source draft', async () => {
    const onSaved = vi.fn()
    const { container } = await renderDialog({ onSaved })
    const name = container.querySelector<HTMLInputElement>('[aria-label="提取工作流名称"]')!
    await act(async () => setInput(name, '镜头图工作流'))
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="保存提取的画布工作流"]')!.click(),
    )

    expect(canvasWorkflowApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '镜头图工作流',
        scope: 'project',
        projectId: 'project-1',
      }),
    )
    expect(draft.name).toBe('生成镜头图')
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('updates an existing project workflow as a new draft version', async () => {
    const existing = {
      ...(await canvasWorkflowApi.create({} as never)),
      id: 'existing-workflow',
      name: '旧名称',
    }
    vi.mocked(canvasWorkflowApi.create).mockClear()
    const { container } = await renderDialog({ workflowToUpdate: existing })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="更新选中的画布工作流"]')!.click(),
    )

    expect(canvasWorkflowApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing-workflow', package: expect.any(Object) }),
    )
    expect(canvasWorkflowApi.create).not.toHaveBeenCalled()
  })
})
