// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasWorkflowDefinition } from '@spark/protocol'
import { CanvasWorkflowDrawer } from './CanvasWorkflowDrawer'
import { canvasWorkflowApi } from './canvasWorkflow.api'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./canvasWorkflow.api', () => ({
  canvasWorkflowApi: {
    list: vi.fn(),
    listPage: vi.fn(),
    create: vi.fn(),
    duplicate: vi.fn(),
    delete: vi.fn(),
  },
}))

const emptyPackage = {
  schemaVersion: 1 as const,
  graph: { nodes: [], edges: [] },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: [], canvasNodeKinds: [] },
}

function workflow(
  id: string,
  scope: CanvasWorkflowDefinition['scope'],
  projectId: string | null,
): CanvasWorkflowDefinition {
  return {
    id,
    projectId,
    name: id === 'personal' ? '个人镜头模板' : id === 'builtin' ? '内置分镜模板' : '项目工作流',
    description: null,
    scope,
    status: 'draft',
    version: 1,
    tags: [],
    package:
      id === 'project'
        ? {
            ...emptyPackage,
            graph: {
              nodes: [
                {
                  id: 'node-1',
                  kind: 'canvas_operation' as const,
                  label: '生成',
                  position: { x: 0, y: 0 },
                  config: { operation: 'text_to_image' },
                },
              ],
              edges: [],
            },
          }
        : emptyPackage,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

async function renderDrawer(
  overrides: Partial<React.ComponentProps<typeof CanvasWorkflowDrawer>> = {},
) {
  const props: React.ComponentProps<typeof CanvasWorkflowDrawer> = {
    open: true,
    projectId: 'project-1',
    projectName: '品牌短片',
    selectedNodeCount: 2,
    onClose: vi.fn(),
    onExtractSelection: vi.fn(),
    onAddWorkflow: vi.fn(),
    onUpdateFromSelection: vi.fn(),
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(<CanvasWorkflowDrawer {...props} />)
    await Promise.resolve()
  })
  return { container, props, root }
}

beforeEach(() => {
  const items = [
    workflow('project', 'project', 'project-1'),
    workflow('personal', 'library', null),
    workflow('builtin', 'builtin', null),
  ]
  vi.mocked(canvasWorkflowApi.list).mockResolvedValue(items)
  vi.mocked(canvasWorkflowApi.listPage).mockImplementation(async (request = {}) => {
    const filtered = items.filter(
      (item) =>
        (!request.scope || item.scope === request.scope) &&
        (!request.projectId || item.projectId === request.projectId),
    )
    return { workflows: filtered, total: filtered.length, hasMore: false }
  })
  vi.mocked(canvasWorkflowApi.duplicate).mockResolvedValue(
    workflow('personal-copy', 'project', 'project-1'),
  )
  vi.mocked(canvasWorkflowApi.delete).mockResolvedValue(true)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

describe('CanvasWorkflowDrawer', () => {
  it('shows project, personal, and builtin workflows by default', async () => {
    const { container } = await renderDrawer()

    expect(
      container.querySelector('.canvas-workflow-drawer-list')?.getAttribute('data-load-state'),
    ).toBe('ready')
    expect(container.textContent).toContain('项目工作流')
    expect(container.textContent).toContain('个人镜头模板')
    expect(container.textContent).toContain('内置分镜模板')
    expect(canvasWorkflowApi.listPage).toHaveBeenCalledWith(
      expect.not.objectContaining({ scope: expect.anything(), projectId: expect.anything() }),
    )
  })

  it('deletes a selected project workflow from the drawer', async () => {
    const { container } = await renderDrawer()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="删除项目工作流"]')!.click(),
    )

    expect(window.confirm).toHaveBeenCalledWith('删除画布工作流“项目工作流”？此操作不可撤销。')
    expect(canvasWorkflowApi.delete).toHaveBeenCalledWith('project')
    expect(container.querySelector('[aria-label="选择项目工作流"]')).toBeNull()
  })

  it('keeps a workflow visible and reports the error when deletion fails', async () => {
    vi.mocked(canvasWorkflowApi.delete).mockRejectedValueOnce(new Error('删除失败'))
    const { container } = await renderDrawer()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="删除项目工作流"]')!.click(),
    )

    expect(container.querySelector('[aria-label="选择项目工作流"]')).not.toBeNull()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('删除失败')
  })

  it('does not offer deletion for builtin workflows', async () => {
    const { container } = await renderDrawer()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="选择内置分镜模板"]')!.click(),
    )

    expect(container.querySelector('[aria-label="删除内置分镜模板"]')).toBeNull()
  })

  it('enables extraction only for a multi-node selection', async () => {
    const disabled = await renderDrawer({ selectedNodeCount: 1 })
    expect(
      disabled.container.querySelector<HTMLButtonElement>('[aria-label="从当前选区提取工作流"]')!
        .disabled,
    ).toBe(true)

    const onExtractSelection = vi.fn()
    const enabled = await renderDrawer({ selectedNodeCount: 3, onExtractSelection })
    await act(async () =>
      enabled.container
        .querySelector<HTMLButtonElement>('[aria-label="从当前选区提取工作流"]')!
        .click(),
    )
    expect(onExtractSelection).toHaveBeenCalledOnce()
  })

  it('adds the selected workflow graph to the canvas instead of opening a run panel', async () => {
    const onAddWorkflow = vi.fn()
    const { container } = await renderDrawer({ onAddWorkflow })

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="添加项目工作流到画布"]')!.click(),
    )

    expect(onAddWorkflow).toHaveBeenCalledWith(expect.objectContaining({ id: 'project' }))
  })

  it('writes the workflow id to the private drag payload', async () => {
    const { container } = await renderDrawer()
    const item = container.querySelector<HTMLButtonElement>('[aria-label="选择项目工作流"]')!
    const setData = vi.fn()
    const event = new Event('dragstart', { bubbles: true })
    Object.defineProperty(event, 'dataTransfer', {
      value: { setData, effectAllowed: 'none' },
    })

    act(() => item.dispatchEvent(event))

    expect(item.draggable).toBe(true)
    expect(setData).toHaveBeenCalledWith('application/x-spark-canvas-workflow', 'project')
    expect(
      container.querySelector('.canvas-workflow-drawer-layer')?.classList.contains('is-dragging'),
    ).toBe(true)

    act(() => item.dispatchEvent(new Event('dragend', { bubbles: true })))
    expect(
      container.querySelector('.canvas-workflow-drawer-layer')?.classList.contains('is-dragging'),
    ).toBe(false)
  })

  it('closes from the labeled icon button', async () => {
    const onClose = vi.fn()
    const { container } = await renderDrawer({ onClose })
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="关闭画布工作流"]')!.click(),
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('restores focus to the trigger when the drawer closes', async () => {
    const trigger = document.createElement('button')
    trigger.textContent = '画布工作流'
    document.body.appendChild(trigger)
    trigger.focus()
    const { props, root } = await renderDrawer()

    await act(async () => {
      root.render(<CanvasWorkflowDrawer {...props} open={false} />)
      await Promise.resolve()
    })

    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('loads more workflows inside the active drawer scope', async () => {
    const first = Array.from({ length: 40 }, (_, index) =>
      workflow(`project-${index}`, 'project', 'project-1'),
    )
    vi.mocked(canvasWorkflowApi.listPage)
      .mockResolvedValueOnce({ workflows: first, total: 41, hasMore: true })
      .mockResolvedValueOnce({
        workflows: [workflow('project-40', 'project', 'project-1')],
        total: 41,
        hasMore: false,
      })
    const { container } = await renderDrawer()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="加载更多当前范围工作流"]')!.click(),
    )

    expect(canvasWorkflowApi.listPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 40, offset: 40 }),
    )
  })
})
