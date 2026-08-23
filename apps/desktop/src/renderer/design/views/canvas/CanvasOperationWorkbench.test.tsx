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

function snapshotWithAssetOnlyOutput(node: CanvasNode): CanvasSnapshot {
  node.taskId = 'task-asset'
  const base = snapshot(node)
  return {
    ...base,
    assets: [
      {
        id: 'asset-only',
        projectId: 'project-1',
        userId: 1,
        type: 'image',
        source: 'ai_generated',
        title: '全景产物',
        url: 'https://example.com/panorama.png',
        metadata: { panorama360: { projection: 'equirectangular' } },
        createdAt: at,
        updatedAt: at,
      },
    ],
    tasks: [
      {
        id: 'task-asset',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        operation: 'panorama_360',
        status: 'completed',
        progress: 100,
        operationNodeId: node.id,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: [],
        outputAssetIds: ['asset-only'],
        modelParams: {},
        createdAt: at,
        updatedAt: at,
      },
    ],
  }
}

function snapshotWithCurrentRun(
  node: CanvasNode,
  currentStatus: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled',
): CanvasSnapshot {
  // 当前 taskId 指向最新一次无产物运行；另有一个旧的 completed run（有产物 + edge）。
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
  it('keeps run history available when every run has no outputs', async () => {
    const node = operationNode()
    node.taskId = 'task-current'
    const currentSnapshot = snapshot(node)
    const taskBase = {
      projectId: 'project-1',
      boardId: 'board-1',
      userId: 1,
      operation: 'text_to_image' as const,
      operationNodeId: node.id,
      progress: 0,
      inputNodeIds: [] as string[],
      inputAssetIds: [] as string[],
      outputNodeIds: [] as string[],
      outputAssetIds: [] as string[],
      modelParams: {} as Record<string, unknown>,
      updatedAt: at,
    }
    currentSnapshot.tasks = [
      {
        ...taskBase,
        id: 'task-current',
        status: 'failed',
        createdAt: '2026-07-17T00:03:00.000Z',
      },
      {
        ...taskBase,
        id: 'task-old',
        status: 'cancelled',
        createdAt: '2026-07-17T00:01:00.000Z',
      },
    ]
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <CanvasOperationWorkbench
          node={node}
          snapshot={currentSnapshot}
          configPanel={<div>任务配置内容</div>}
          onSaveOutput={vi.fn()}
          onRenameNode={vi.fn()}
          onDeleteRun={vi.fn()}
        />,
      )
    })

    const historyTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-operation-workbench-tab'),
    ).find((tab) => tab.textContent?.includes('运行历史'))
    expect(historyTab?.textContent).toContain('2')
    expect(historyTab?.disabled).toBe(false)

    await act(async () => historyTab?.click())
    const historyItems = container.querySelectorAll<HTMLElement>('.canvas-operation-history-item')
    expect(historyItems).toHaveLength(2)
    expect(container.textContent).toContain('第 2 次运行')
    expect(container.textContent).toContain('第 1 次运行')

    await act(async () => historyItems[0]?.click())
    expect(container.querySelector('.canvas-operation-workbench-empty.is-failed')).not.toBeNull()
    expect(container.textContent).toContain('第 2 次运行失败')

    await act(async () => root.unmount())
    container.remove()
  })

  it('orders task config first and keeps settings available without outputs', async () => {
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
      '任务配置',
      '节点设置',
      '产物',
      '运行历史',
    ])
    expect(tabs[1]?.disabled).toBe(false)
    expect(container.textContent).toContain('任务配置内容')

    await act(async () => tabs[1]?.click())
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

    const outputTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-operation-workbench-tab'),
    ).find((tab) => tab.textContent?.includes('产物'))
    await act(async () => outputTab?.click())

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

  it('keeps download and panorama actions available for asset-only outputs', async () => {
    const node = operationNode()
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const onDownloadOutput = vi.fn()
    const onPreviewPanoramaOutput = vi.fn()

    await act(async () => {
      root.render(
        <CanvasOperationWorkbench
          node={node}
          snapshot={snapshotWithAssetOnlyOutput(node)}
          configPanel={<div>任务配置内容</div>}
          onSaveOutput={vi.fn()}
          onRenameNode={vi.fn()}
          onDownloadOutput={onDownloadOutput}
          onPreviewPanoramaOutput={onPreviewPanoramaOutput}
        />,
      )
    })

    const outputTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-operation-workbench-tab'),
    ).find((tab) => tab.textContent?.includes('产物'))
    await act(async () => outputTab?.click())

    const popover = document.querySelector('[data-testid="popover-content"]')
    const downloadButton = Array.from(popover?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('下载当前产物'),
    )
    const panoramaButton = Array.from(popover?.querySelectorAll('button') ?? []).find((button) =>
      button.textContent?.includes('全景预览'),
    )
    expect(downloadButton).toBeTruthy()
    expect(panoramaButton).toBeTruthy()

    await act(async () => downloadButton?.click())
    await act(async () => panoramaButton?.click())
    expect(onDownloadOutput).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-only', taskId: 'task-asset' }),
    )
    expect(onPreviewPanoramaOutput).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: 'asset-only', panorama360: expect.any(Object) }),
    )

    await act(async () => root.unmount())
    container.remove()
  })

  it('shows a running banner while keeping earlier outputs visible and navigable', async () => {
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

    const outputTab = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.canvas-operation-workbench-tab'),
    ).find((tab) => tab.textContent?.includes('产物'))
    await act(async () => outputTab?.click())

    // 运行中横幅可见（不自动切 tab，但进度要看得见）
    const banner = container.querySelector('[role="status"]')
    expect(banner?.textContent).toContain('运行中')
    // 最新 running 轮次无产物时，状态仍真实显示；默认预览最近成功产物并保留翻页器。
    expect(container.querySelector('.canvas-operation-workbench-run-nav')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-workbench-output-list-empty')).toBeNull()
    expect(
      container.querySelector('.canvas-operation-workbench-output-list')?.textContent,
    ).toContain('旧产物')
    expect(container.querySelector('.canvas-operation-workbench-preview img')).not.toBeNull()
    expect(container.querySelector('.canvas-operation-workbench-empty.is-running')).toBeNull()

    await act(async () => root.unmount())
    container.remove()
  })

  it.each(['pending', 'running', 'completed', 'failed', 'cancelled'] as const)(
    'offers run deletion for a %s run without successful outputs',
    async (status) => {
      const node = operationNode()
      const container = document.createElement('div')
      document.body.appendChild(container)
      const root = createRoot(container)
      const onDeleteRun = vi.fn()

      await act(async () => {
        root.render(
          <CanvasOperationWorkbench
            node={node}
            snapshot={snapshotWithCurrentRun(node, status)}
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

      // current=非成功或 completed 空记录(可删) + old completed 有产物(不可删) → 仅当前一个可删
      const deleteButtons = container.querySelectorAll('[aria-label="删除这次运行记录"]')
      expect(deleteButtons).toHaveLength(1)

      await act(async () => root.unmount())
      container.remove()
    },
  )
})
