// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@lobehub/ui', () => ({
  Button: 'button',
  Tag: 'span',
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

import { CanvasOperationWorkbench } from './CanvasOperationWorkbench'
import type { CanvasNode, CanvasSnapshot } from './canvas.types'
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
})
