// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@lobehub/ui', () => ({
  Button: 'button',
  Tag: 'span',
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>()
  return {
    ...actual,
    Modal: { ...actual.Modal, confirm: vi.fn() },
    Popover: ({ children, content }: { children: ReactNode; content: ReactNode }) => (
      <>
        {children}
        {createPortal(<div data-testid="popover-content">{content}</div>, document.body)}
      </>
    ),
  }
})

import { CanvasOperationWorkbench } from './CanvasOperationWorkbench'
import type { CanvasNode, CanvasSnapshot, CanvasTask } from './canvas.types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const at = '2026-07-17T00:00:00.000Z'

function operationNode(): CanvasNode {
  return {
    id: 'operation-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text_to_image',
    title: '海边日落',
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { operation: 'text_to_image' },
    createdAt: at,
    updatedAt: at,
  }
}

function snapshot(node: CanvasNode): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: 1,
      assetCount: 0,
      taskCount: 0,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 1,
      name: 'Board',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    nodes: [node],
    edges: [],
    assets: [],
    tasks: [],
  }
}

function snapshotWithOutputs(node: CanvasNode): CanvasSnapshot {
  node.taskId = 'task-1'
  const outputNodes: CanvasNode[] = ['角色设定：老李', '角色设定：小王'].map((title, index) => ({
    id: `output-${index + 1}`,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'image',
    title,
    x: 360 + index * 220,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { url: `https://example.com/output-${index + 1}.png` },
    createdAt: at,
    updatedAt: at,
  }))
  const base = snapshot(node)
  return {
    ...base,
    nodes: [node, ...outputNodes],
    edges: outputNodes.map((outputNode, index) => ({
      id: `edge-${index + 1}`,
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 1,
      sourceNodeId: node.id,
      targetNodeId: outputNode.id,
      type: 'generated' as const,
      taskId: 'task-1',
      metadata: {},
      createdAt: at,
    })),
    tasks: [
      {
        id: 'task-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        operation: 'text_to_image',
        status: 'completed',
        progress: 100,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: outputNodes.map((outputNode) => outputNode.id),
        outputAssetIds: [],
        modelParams: {},
        createdAt: at,
        updatedAt: at,
      },
    ],
  }
}

function snapshotWithCurrentRun(
  node: CanvasNode,
  currentStatus: 'running' | 'failed',
): CanvasSnapshot {
  // 当前 taskId 指向最新一次运行（running/failed，无产物）；另有一个旧的 completed run（有产物 + edge）。
  // runs 按 createdAt 降序：current 在前，old 在后。无产物的 run 仅在作为 node.taskId 时被收集。
  node.taskId = 'task-current'
  const oldOutput: CanvasNode = {
    id: 'output-old',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'image',
    title: '旧产物',
    x: 360,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { url: 'https://example.com/output-old.png' },
    createdAt: at,
    updatedAt: at,
  }
  const base = snapshot(node)
  const taskBase = {
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    operation: 'text_to_image',
    inputNodeIds: [] as string[],
    inputAssetIds: [] as string[],
    outputAssetIds: [] as string[],
    modelParams: {} as Record<string, unknown>,
    updatedAt: at,
  }
  return {
    ...base,
    nodes: [node, oldOutput],
    edges: [
      {
        id: 'edge-old',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        sourceNodeId: node.id,
        targetNodeId: 'output-old',
        type: 'generated' as const,
        taskId: 'task-old',
        metadata: {},
        createdAt: at,
      },
    ],
    tasks: [
      {
        ...taskBase,
        id: 'task-current',
        status: currentStatus,
        progress: currentStatus === 'running' ? 42 : 0,
        outputNodeIds: [],
        ...(currentStatus === 'failed' ? { errorMsg: '生成失败' } : {}),
        createdAt: '2026-07-17T00:03:00.000Z',
      } as CanvasTask,
      {
        ...taskBase,
        id: 'task-old',
        status: 'completed',
        progress: 100,
        outputNodeIds: ['output-old'],
        createdAt: '2026-07-17T00:01:00.000Z',
      } as CanvasTask,
    ],
  }
}

describe('CanvasOperationWorkbench', () => {
  it('places history after node settings and keeps settings available without outputs', async () => {
    const node = operationNode()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CanvasOperationWorkbench
          node={node}
          snapshot={snapshot(node)}
          configPanel={<div>任务配置内容</div>}
          onSaveOutput={vi.fn()}
          onRenameNode={vi.fn()}
        />,
      )
    })

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-operation-workbench-tab'),
    )
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      '产物',
      '任务配置',
      '节点设置',
      '运行历史',
    ])
    expect(tabs[2]?.disabled).toBe(false)

    await act(async () => tabs[2]?.click())
    expect(container.querySelector<HTMLInputElement>('[aria-label="节点名称"]')?.value).toBe(
      '海边日落',
    )

    await act(async () => root.unmount())
    container.remove()
  })

  it('keeps the output strip scrollable and moves secondary actions into more', async () => {
    const node = operationNode()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CanvasOperationWorkbench
          node={node}
          snapshot={snapshotWithOutputs(node)}
          configPanel={<div>任务配置内容</div>}
          onSaveOutput={vi.fn()}
          onRenameNode={vi.fn()}
          onExpandOutputs={vi.fn()}
          onDeleteOutputs={vi.fn()}
          onDownloadOutput={vi.fn()}
        />,
      )
    })

    const actions = container.querySelector('[aria-label="产物操作"]')
    const outputStrip = container.querySelector<HTMLElement>(
      '[aria-label="可横向滚动的本次运行产物"]',
    )
    expect(actions).not.toBeNull()
    expect(outputStrip?.tabIndex).toBe(0)
    expect(actions?.textContent).not.toContain('展开当前')
    expect(document.querySelector('.canvas-operation-more-menu')?.textContent).toContain(
      '展开当前产物',
    )

    await act(async () => root.unmount())
    container.remove()
  })

  it('shows a running banner and keeps the run navigator when the newest run has no output', async () => {
    const node = operationNode()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CanvasOperationWorkbench
          node={node}
          snapshot={snapshotWithCurrentRun(node, 'running')}
          configPanel={<div>任务配置内容</div>}
          onSaveOutput={vi.fn()}
          onRenameNode={vi.fn()}
        />,
      )
    })

    // 运行中横幅可见（不自动切 tab，但进度要看得见）
    const banner = container.querySelector('[role="status"]')
    expect(banner?.textContent).toContain('运行中')
    // 最新 run 无产物时翻页器仍常驻，不会被产物预览/空态挤掉
    expect(container.querySelector('.canvas-operation-workbench-run-nav')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-workbench-output-list-empty')).not.toBeNull()
    // content 区进入运行中空态（而非笼统空态）
    expect(container.querySelector('.canvas-operation-workbench-empty.is-running')).not.toBeNull()

    await act(async () => root.unmount())
    container.remove()
  })

  it('offers run deletion only for failed/cancelled runs in history', async () => {
    const node = operationNode()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onDeleteRun = vi.fn()

    await act(async () => {
      root.render(
        <CanvasOperationWorkbench
          node={node}
          snapshot={snapshotWithCurrentRun(node, 'failed')}
          configPanel={<div>任务配置内容</div>}
          onSaveOutput={vi.fn()}
          onRenameNode={vi.fn()}
          onDeleteRun={onDeleteRun}
        />,
      )
    })

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-operation-workbench-tab'),
    )
    const historyTab = tabs.find((tab) => tab.textContent?.includes('运行历史'))
    await act(async () => historyTab?.click())

    // current=failed(可删) + old completed 有产物(不可删) → 仅 failed 一个可删
    const deleteButtons = container.querySelectorAll('[aria-label="删除这次运行记录"]')
    expect(deleteButtons).toHaveLength(1)

    await act(async () => root.unmount())
    container.remove()
  })
})
