// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCanvasHotCache, canvasApi, type CanvasDb } from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'
const future = '2099-01-01T00:00:00.000Z'

function seedDb(): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: 'Project',
        status: 'active',
        settings: {},
        nodeCount: 1,
        assetCount: 1,
        taskCount: 0,
        createdAt: future,
        updatedAt: future,
      },
    ],
    boards: [
      {
        id: 'board-1',
        projectId: 'project-1',
        userId: 0,
        name: 'Canvas',
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: {},
        createdAt: future,
        updatedAt: future,
      },
    ],
    nodes: [
      {
        id: 'node-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        type: 'text',
        title: 'Text note',
        x: 0,
        y: 0,
        width: 320,
        height: 200,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        assetId: 'asset-1',
        data: { text: 'old' },
        createdAt: future,
        updatedAt: future,
      },
    ],
    edges: [],
    assets: [
      {
        id: 'asset-1',
        projectId: 'project-1',
        userId: 0,
        type: 'text',
        source: 'manual',
        title: 'Text note',
        contentText: 'old',
        metadata: { nodeId: 'node-1' },
        createdAt: future,
        updatedAt: future,
      },
    ],
    tasks: [],
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  __resetCanvasHotCache()
}

describe('canvas node data updates', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.assign(window, {
      spark: {
        invoke: vi.fn().mockResolvedValue({ rootPath: '/tmp/project-1' }),
      },
    })
    seedDb()
  })

  it('atomically replaces title and data while advancing the node version', async () => {
    const first = await canvasApi.updateNode('project-1', 'node-1', {
      title: 'Updated note',
      data: { text: 'first' },
    })
    const firstNode = first.nodes.find((node) => node.id === 'node-1')
    const second = await canvasApi.updateNodeData('project-1', 'node-1', { text: 'second' })
    const secondNode = second.nodes.find((node) => node.id === 'node-1')

    expect(firstNode?.updatedAt).toBe('2099-01-01T00:00:00.001Z')
    expect(firstNode).toMatchObject({ title: 'Updated note', data: { text: 'first' } })
    expect(secondNode?.updatedAt).toBe('2099-01-01T00:00:00.002Z')
    expect(secondNode?.data.text).toBe('second')
    expect(second.assets.find((asset) => asset.id === 'asset-1')?.contentText).toBe('second')
  })
})
