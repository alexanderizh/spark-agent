// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CanvasWorkflowDefinition } from '@spark/protocol'
import type { CanvasProject } from './canvas.types'
import { CanvasWorkflowLibraryView } from './CanvasWorkflowLibraryView'
import { canvasWorkflowApi } from './canvasWorkflow.api'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../AppContext', () => ({
  useApp: () => ({
    t: { sidebarHidden: false },
    setTweak: vi.fn(),
  }),
}))

vi.mock('./canvas.store', () => ({
  useCanvasProjects: () => ({ projects: [], loading: false, refresh: vi.fn() }),
}))

vi.mock('./canvasWorkflow.api', () => ({
  canvasWorkflowApi: {
    list: vi.fn(),
    listPage: vi.fn(),
    create: vi.fn(),
    archive: vi.fn(),
    delete: vi.fn(),
    duplicate: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    listVersions: vi.fn(),
    listRuns: vi.fn(),
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
  name: string,
  scope: CanvasWorkflowDefinition['scope'],
  projectId: string | null = null,
): CanvasWorkflowDefinition {
  return {
    id,
    projectId,
    name,
    description: `${name}描述`,
    scope,
    status: 'draft',
    version: 1,
    tags: [],
    package: emptyPackage,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

const projects: CanvasProject[] = [
  {
    id: 'project-1',
    userId: 0,
    title: '品牌短片',
    status: 'active',
    nodeCount: 0,
    assetCount: 0,
    taskCount: 0,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  },
]

const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

async function renderView() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(<CanvasWorkflowLibraryView projects={projects} />)
    await Promise.resolve()
  })
  return container
}

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  const items = [
    workflow('library-1', '社媒套图', 'library'),
    workflow('project-1-flow', '镜头批量生成', 'project', 'project-1'),
  ]
  vi.mocked(canvasWorkflowApi.list).mockResolvedValue(items)
  vi.mocked(canvasWorkflowApi.listPage).mockImplementation(async (request = {}) => {
    const filtered = items.filter((item) => {
      if (request.scope && item.scope !== request.scope) return false
      if (request.status && item.status !== request.status) return false
      if (!request.includeArchived && item.status === 'archived') return false
      const keyword = request.query?.toLowerCase()
      return !keyword || `${item.name} ${item.description ?? ''}`.toLowerCase().includes(keyword)
    })
    return { workflows: filtered, total: filtered.length, hasMore: false }
  })
  vi.mocked(canvasWorkflowApi.create).mockResolvedValue(
    workflow('created-1', '新工作流', 'library'),
  )
  vi.mocked(canvasWorkflowApi.listVersions).mockResolvedValue([])
  vi.mocked(canvasWorkflowApi.listRuns).mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
  while (mounted.length > 0) {
    const item = mounted.pop()!
    act(() => item.root.unmount())
    item.container.remove()
  }
})

describe('CanvasWorkflowLibraryView', () => {
  it('filters project and personal workflows with accessible scope buttons', async () => {
    const container = await renderView()
    expect(container.textContent).toContain('社媒套图')
    expect(container.textContent).toContain('镜头批量生成')

    const personal = container.querySelector<HTMLButtonElement>('[aria-label="只看个人工作流"]')!
    await act(async () => personal.click())

    expect(container.textContent).toContain('社媒套图')
    expect(container.textContent).not.toContain('镜头批量生成')
  })

  it('searches by workflow name', async () => {
    const container = await renderView()
    const input = container.querySelector<HTMLInputElement>('[aria-label="搜索画布工作流"]')!
    await act(async () => setInput(input, '镜头'))

    expect(container.textContent).toContain('镜头批量生成')
    expect(container.textContent).not.toContain('社媒套图')
  })

  it('creates a personal workflow draft from the dialog', async () => {
    const container = await renderView()
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="新建画布工作流"]')!.click(),
    )
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    const name = container.querySelector<HTMLInputElement>('[aria-label="工作流名称"]')!
    await act(async () => setInput(name, '新工作流'))
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="创建工作流草稿"]')!.click(),
    )

    expect(canvasWorkflowApi.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '新工作流', scope: 'library', package: emptyPackage }),
    )
  })

  it('edits metadata through update and publishes a runnable definition', async () => {
    const runnable = workflow('library-1', '社媒套图', 'library')
    runnable.package = {
      ...emptyPackage,
      graph: {
        nodes: [
          {
            id: 'generate',
            kind: 'canvas_operation',
            label: '生成',
            position: { x: 0, y: 0 },
            config: { operation: 'text_to_image' },
          },
        ],
        edges: [],
      },
    }
    vi.mocked(canvasWorkflowApi.list).mockResolvedValue([runnable])
    vi.mocked(canvasWorkflowApi.listPage).mockResolvedValue({
      workflows: [runnable],
      total: 1,
      hasMore: false,
    })
    vi.mocked(canvasWorkflowApi.update).mockResolvedValue({ ...runnable, name: '社媒视觉套图' })
    vi.mocked(canvasWorkflowApi.publish).mockResolvedValue({
      workflow: { ...runnable, name: '社媒视觉套图', status: 'published' },
      version: {
        workflowId: runnable.id,
        version: 1,
        name: '社媒视觉套图',
        package: runnable.package,
        createdAt: runnable.updatedAt,
      },
    })
    const container = await renderView()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="编辑工作流详情"]')!.click(),
    )
    const name = container.querySelector<HTMLInputElement>('[aria-label="编辑工作流名称"]')!
    await act(async () => setInput(name, '社媒视觉套图'))
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="保存工作流详情"]')!.click(),
    )
    expect(canvasWorkflowApi.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'library-1', name: '社媒视觉套图' }),
    )

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="发布画布工作流"]')!.click(),
    )
    expect(canvasWorkflowApi.publish).toHaveBeenCalledWith('library-1')
    expect(container.textContent).toContain('已发布')
  })

  it('loads the next server page without replacing the current selection', async () => {
    const first = Array.from({ length: 30 }, (_, index) =>
      workflow(`workflow-${index}`, `工作流 ${index}`, 'library'),
    )
    vi.mocked(canvasWorkflowApi.listPage)
      .mockResolvedValueOnce({ workflows: first, total: 31, hasMore: true })
      .mockResolvedValueOnce({
        workflows: [workflow('workflow-30', '工作流 30', 'library')],
        total: 31,
        hasMore: false,
      })
    const container = await renderView()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[aria-label="加载更多画布工作流"]')!.click(),
    )

    expect(canvasWorkflowApi.listPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 30, offset: 30 }),
    )
    expect(container.textContent).toContain('工作流 30')
  })
})
