// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCanvasHotCache, canvasApi } from './canvas.api'
import type { CanvasDb } from './canvas.api'
import { applyCanvasNodeLayoutUpdates } from './canvasNodeLayoutPersistence'
import type { CanvasNode } from './canvas.types'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-07-24T00:00:00.000Z'

function createNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
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
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function seedDb(nodes: CanvasNode[]): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: 'Project',
        status: 'active',
        rootPath: '/tmp/project-1',
        settings: {},
        nodeCount: nodes.filter((node) => !node.hidden).length,
        assetCount: 0,
        taskCount: 0,
        createdAt: at,
        updatedAt: at,
      },
    ],
    boards: [
      {
        id: 'board-1',
        projectId: 'project-1',
        userId: 0,
        name: 'Board',
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        createdAt: at,
        updatedAt: at,
      },
    ],
    nodes,
    edges: [],
    assets: [],
    tasks: [],
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

describe('canvas node layout persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({ rootPath: '/tmp/project-1' }) },
    })
  })

  it('does not resurrect a deleted node when a stale layout update arrives later', async () => {
    seedDb([createNode()])
    const staleLayoutNodes = (await canvasApi.openSnapshot('project-1')).nodes

    await canvasApi.deleteNodes('project-1', ['node-1'])
    await canvasApi.updateNodes('project-1', staleLayoutNodes)

    const snapshot = await canvasApi.openSnapshot('project-1')
    expect(snapshot.nodes).toEqual([])
    expect(snapshot.project.nodeCount).toBe(0)
  })

  it('updates only layout fields for a visible node', async () => {
    seedDb([createNode()])

    await canvasApi.updateNodes('project-1', [
      createNode({
        x: 80,
        y: 90,
        width: 360,
        height: 240,
        title: 'stale title',
        locked: true,
        hidden: true,
        rotation: 45,
        zIndex: 99,
        data: { text: 'stale content' },
      }),
    ])

    const snapshot = await canvasApi.openSnapshot('project-1')
    expect(snapshot.nodes).toHaveLength(1)
    expect(snapshot.nodes[0]).toMatchObject({
      id: 'node-1',
      x: 80,
      y: 90,
      width: 360,
      height: 240,
      title: 'Node',
      locked: false,
      hidden: false,
      rotation: 0,
      zIndex: 1,
      data: { text: 'hello' },
    })
  })

  it('ignores a layout payload whose project identity does not match', async () => {
    seedDb([createNode()])

    await canvasApi.updateNodes('project-1', [
      createNode({ projectId: 'project-2', x: 999, y: 999 }),
    ])

    const snapshot = await canvasApi.openSnapshot('project-1')
    expect(snapshot.nodes).toHaveLength(1)
    expect(snapshot.nodes[0]).toMatchObject({ projectId: 'project-1', x: 10, y: 20 })
  })
})

describe('applyCanvasNodeLayoutUpdates', () => {
  it('ignores unknown and already-hidden nodes', () => {
    const visible = createNode()
    const hidden = createNode({ id: 'hidden-node', hidden: true })
    const current = [visible, hidden]

    const result = applyCanvasNodeLayoutUpdates({
      nodes: current,
      projectId: 'project-1',
      updates: [
        createNode({ id: 'unknown-node', x: 999 }),
        createNode({ id: 'hidden-node', x: 999 }),
      ],
      updatedAt: '2026-07-24T01:00:00.000Z',
    })

    expect(result.changed).toBe(false)
    expect(result.nodes).toBe(current)
    expect(result.nodes[1]).toBe(hidden)
  })

  it('preserves references when a visible node layout is unchanged', () => {
    const node = createNode()
    const current = [node]

    const result = applyCanvasNodeLayoutUpdates({
      nodes: current,
      projectId: 'project-1',
      updates: [createNode()],
      updatedAt: '2026-07-24T01:00:00.000Z',
    })

    expect(result.changed).toBe(false)
    expect(result.nodes).toBe(current)
    expect(result.nodes[0]).toBe(node)
  })
})
