// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasApi } from './canvas.api'
import type { CanvasDb } from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'

const at = '2026-06-18T00:00:00.000Z'

function seedCanvasDb(db: CanvasDb) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

describe('canvas operation inheritance', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('window', window)
    Object.assign(window, {
      spark: {
        invoke: vi.fn().mockResolvedValue({ rootPath: '/tmp/project-1' }),
      },
    })
  })

  it('creates downstream operation nodes with inherited negative prompt and key model params', async () => {
    seedCanvasDb({
      projects: [
        {
          id: 'project-1',
          userId: 0,
          title: 'Project',
          status: 'active',
          settings: { prompt: 'project prompt', negativePrompt: 'project negative' },
          nodeCount: 1,
          assetCount: 1,
          taskCount: 1,
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
      assets: [
        {
          id: 'asset-1',
          projectId: 'project-1',
          userId: 0,
          type: 'image',
          source: 'ai_generated',
          title: 'Source image',
          url: 'file:///source.png',
          metadata: {},
          createdAt: at,
          updatedAt: at,
        },
      ],
      nodes: [
        {
          id: 'node-source',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'image',
          title: 'Source image',
          assetId: 'asset-1',
          taskId: 'task-source',
          parentNodeId: null,
          x: 10,
          y: 20,
          width: 240,
          height: 180,
          rotation: 0,
          zIndex: 1,
          locked: false,
          hidden: false,
          data: { url: 'file:///source.png' },
          createdAt: at,
          updatedAt: at,
        },
      ],
      edges: [],
      tasks: [
        {
          id: 'task-source',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'completed',
          progress: 100,
          title: 'Source task',
          prompt: 'cinematic portrait',
          negativePrompt: 'blurry, low quality',
          inputNodeIds: [],
          inputAssetIds: [],
          outputNodeIds: ['node-source'],
          outputAssetIds: ['asset-1'],
          modelParams: { aspectRatio: '16:9', seed: 1234, internalDebug: true },
          createdAt: at,
          updatedAt: at,
        },
      ],
    })

    const snapshot = await canvasApi.createOperationNode({
      projectId: 'project-1',
      boardId: 'board-1',
      operation: 'image_to_image',
      inputNodeIds: ['node-source'],
      x: 310,
      y: 20,
    })

    const operationNode = snapshot.nodes.find((node) => node.type === 'image_to_image')
    expect(operationNode).toBeDefined()
    const pendingTask = snapshot.tasks.find((task) => task.id === operationNode?.taskId)
    expect(pendingTask?.prompt).toBe('cinematic portrait')
    expect(pendingTask?.negativePrompt).toBe('blurry, low quality')
    expect(pendingTask?.modelParams).toEqual({ aspectRatio: '16:9', seed: 1234 })
    expect(operationNode?.data.negativePrompt).toBe('blurry, low quality')
    expect(operationNode?.data.modelParams).toEqual({ aspectRatio: '16:9', seed: 1234 })
  })
})
