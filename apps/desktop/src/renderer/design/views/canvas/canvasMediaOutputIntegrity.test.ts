// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCanvasHotCache, canvasApi, type CanvasDb } from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-07-20T02:41:50.000Z'

function seedDb(status: 'completed' | 'failed'): void {
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: 'Project',
        status: 'active',
        rootPath: '/tmp/project-1',
        nodeCount: 2,
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
    nodes: [
      {
        id: 'operation-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        type: 'image_to_video',
        taskId: 'task-1',
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { operation: 'image_to_video', status, progress: 100 },
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'output-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        type: 'video',
        assetId: 'asset-1',
        x: 360,
        y: 0,
        width: 320,
        height: 180,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { url: 'safe-file://video.mp4', origin: 'task_output' },
        createdAt: at,
        updatedAt: at,
      },
    ],
    edges: [
      {
        id: 'edge-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        sourceNodeId: 'operation-1',
        targetNodeId: 'output-1',
        type: 'generated',
        taskId: 'task-1',
        metadata: {},
        createdAt: at,
      },
    ],
    assets: [
      {
        id: 'asset-1',
        projectId: 'project-1',
        userId: 0,
        type: 'video',
        source: 'ai_generated',
        url: 'safe-file://video.mp4',
        metadata: { taskId: 'task-1' },
        createdAt: at,
        updatedAt: at,
      },
    ],
    tasks: [
      {
        id: 'task-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        operation: 'image_to_video',
        operationNodeId: 'operation-1',
        status,
        progress: 100,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: ['output-1'],
        outputAssetIds: ['asset-1'],
        requestId: 'provider-task-1',
        modelParams: {},
        ...(status === 'failed'
          ? { errorMsg: 'task_timeout', errorDetail: 'Task timed out after 600000ms' }
          : {}),
        createdAt: at,
        updatedAt: at,
        completedAt: at,
      },
    ],
  }
  __resetCanvasHotCache()
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

describe('canvas media output integrity', () => {
  beforeEach(() => {
    window.localStorage.clear()
    Object.assign(window, {
      spark: {
        invoke: vi.fn().mockResolvedValue({ snapshotJson: null }),
      },
    })
  })

  it('does not downgrade a completed task when a late failure arrives', async () => {
    seedDb('completed')

    const snapshot = await canvasApi.applyMediaTaskResult('project-1', 'task-1', {
      status: 'failed',
      mode: 'async',
      runtimeTaskId: 'runtime-1',
      requestId: 'provider-task-1',
      providerProfileId: 'provider-1',
      provider: 'apimart',
      model: 'doubao-seedance-2-0-mini',
      assets: [],
      error: { code: 'task_timeout', message: 'Task timed out after 600000ms' },
    })

    expect(snapshot.tasks[0]?.status).toBe('completed')
    expect(snapshot.nodes.find((node) => node.id === 'operation-1')?.data.status).toBe('completed')
    expect(snapshot.assets).toHaveLength(1)
  })

  it('keeps and recovers failed task records that still index materialized outputs', async () => {
    seedDb('failed')

    canvasApi.deleteTasks('project-1', ['task-1'])
    const snapshot = await canvasApi.openSnapshot('project-1')

    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]).toMatchObject({
      id: 'task-1',
      status: 'completed',
      errorMsg: null,
      errorDetail: null,
    })
    expect(snapshot.nodes.find((node) => node.id === 'operation-1')?.data.status).toBe('completed')
    expect(snapshot.edges).toHaveLength(1)
    expect(snapshot.assets).toHaveLength(1)
  })
})
