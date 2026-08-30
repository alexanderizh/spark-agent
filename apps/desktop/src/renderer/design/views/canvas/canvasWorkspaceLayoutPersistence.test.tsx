// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canvasApi } from './canvas.api'
import { useCanvasWorkspace } from './canvas.store'
import type { CanvasNode, CanvasSnapshot } from './canvas.types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<ReturnType<typeof createRoot>> = []

afterEach(async () => {
  vi.restoreAllMocks()
  while (roots.length > 0) await act(async () => roots.pop()?.unmount())
})

describe('useCanvasWorkspace layout persistence', () => {
  it('does not reinsert a deleted node into renderer state from a stale layout payload', async () => {
    const initial = createSnapshot([createNode()])
    const deleted = createSnapshot([])
    vi.spyOn(canvasApi, 'openSnapshot')
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(deleted)
    vi.spyOn(canvasApi, 'deleteNodes').mockResolvedValue()
    vi.spyOn(canvasApi, 'updateNodes').mockResolvedValue()
    Object.assign(window, {
      spark: {
        on: vi.fn(() => () => undefined),
      },
    })
    const mounted = await mountWorkspace()
    const staleLayoutNodes = mounted.current().snapshot?.nodes ?? []

    await act(async () => mounted.current().deleteNodes(['node-1']))
    expect(mounted.current().snapshot?.nodes).toEqual([])

    await act(async () => mounted.current().updateNodes(staleLayoutNodes))
    expect(mounted.current().snapshot?.nodes).toEqual([])
  })

  it('applies valid layout changes without replacing semantic node fields', async () => {
    const initial = createSnapshot([createNode()])
    vi.spyOn(canvasApi, 'openSnapshot').mockResolvedValueOnce(initial)
    vi.spyOn(canvasApi, 'updateNodes').mockResolvedValue()
    Object.assign(window, {
      spark: {
        on: vi.fn(() => () => undefined),
      },
    })
    const mounted = await mountWorkspace()
    const staleNode: CanvasNode = {
      ...createNode(),
      x: 80,
      y: 90,
      width: 360,
      height: 240,
      title: 'stale title',
      hidden: true,
      data: { text: 'stale content' },
    }

    await act(async () => mounted.current().updateNodes([staleNode]))

    expect(mounted.current().snapshot?.nodes[0]).toMatchObject({
      x: 80,
      y: 90,
      width: 360,
      height: 240,
      title: 'Node',
      hidden: false,
      data: { text: 'hello' },
    })
  })
})

async function mountWorkspace() {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  let current: ReturnType<typeof useCanvasWorkspace> | null = null
  function Harness() {
    current = useCanvasWorkspace('project-1')
    return null
  }
  await act(async () => root.render(<Harness />))
  return {
    current: () => {
      if (!current) throw new Error('Hook is not mounted')
      return current
    },
  }
}

function createNode(): CanvasNode {
  return {
    id: 'node-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    type: 'text',
    title: 'Node',
    x: 10,
    y: 20,
    width: 200,
    height: 120,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { text: 'hello' },
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  }
}

function createSnapshot(nodes: CanvasNode[]): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: 'Project',
      status: 'active',
      nodeCount: nodes.length,
      assetCount: 0,
      taskCount: 0,
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: 'Board',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: '2026-07-24T00:00:00.000Z',
      updatedAt: '2026-07-24T00:00:00.000Z',
    },
    activeBoardId: 'board-1',
    nodes,
    edges: [],
    assets: [],
    tasks: [],
  }
}
