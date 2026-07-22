import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CanvasNode, CanvasTask } from './canvas.types'
import { CanvasTaskQueue } from './CanvasTaskQueue'

vi.mock('@lobehub/ui', () => ({
  Button: ({ children }: { children?: ReactNode }) => <button type="button">{children}</button>,
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}))

vi.mock('antd', () => {
  const Modal = ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null
  Modal.confirm = () => undefined
  return {
    Descriptions: () => null,
    Empty: Object.assign(() => <div>暂无任务</div>, { PRESENTED_IMAGE_SIMPLE: 'simple' }),
    Modal,
    Progress: ({ percent }: { percent?: number }) => <div>{percent}%</div>,
    Space: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  }
})

const node = (overrides: Partial<CanvasNode> = {}): CanvasNode => ({
  id: 'node-1',
  projectId: 'project-1',
  boardId: 'board-1',
  userId: 0,
  type: 'text_to_image',
  title: '生成角色身份板',
  assetId: null,
  taskId: 'task-new',
  parentNodeId: null,
  x: 0,
  y: 0,
  width: 320,
  height: 180,
  rotation: 0,
  zIndex: 1,
  locked: false,
  hidden: false,
  data: { operation: 'text_to_image', status: 'running', progress: 35 },
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:01:00.000Z',
  ...overrides,
})

const task = (overrides: Partial<CanvasTask> = {}): CanvasTask => ({
  id: 'task-old',
  projectId: 'project-1',
  boardId: 'board-1',
  userId: 0,
  operation: 'text_to_image',
  status: 'running',
  progress: 35,
  title: '生成角色身份板',
  operationNodeId: 'node-1',
  prompt: 'prompt',
  negativePrompt: null,
  inputNodeIds: [],
  inputAssetIds: [],
  outputNodeIds: [],
  outputAssetIds: [],
  modelParams: {},
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:01:00.000Z',
  ...overrides,
})

function renderQueue(tasks: CanvasTask[], nodes: CanvasNode[], boardId = 'board-1'): string {
  return renderToStaticMarkup(
    <CanvasTaskQueue
      boardId={boardId}
      tasks={tasks}
      nodes={nodes}
      assets={[]}
      onCancelTask={vi.fn()}
      onClearTasks={vi.fn()}
      onDeleteTasks={vi.fn()}
      onRetryTask={vi.fn()}
      onSelectNode={vi.fn()}
    />,
  )
}

describe('CanvasTaskQueue orphan detection', () => {
  it('does not call a task orphaned when its operation node still exists', () => {
    const html = renderQueue([task()], [node()])

    expect(html).not.toContain('承载节点已被删除')
    expect(html).not.toContain('>无节点<')
  })

  it('does not call a task from another board orphaned', () => {
    const html = renderQueue(
      [task({ boardId: 'board-2', operationNodeId: 'node-on-board-2' })],
      [node({ boardId: 'board-1' })],
    )

    expect(html).not.toContain('承载节点已被删除')
    expect(html).not.toContain('>无节点<')
  })

  it('calls an active task orphaned when the current board has no nodes', () => {
    const html = renderQueue([task()], [])

    expect(html).toContain('承载节点已被删除')
    expect(html).toContain('>无节点<')
  })
})
