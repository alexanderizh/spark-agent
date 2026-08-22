// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasApi, __resetCanvasHotCache, isCanvasDirty, type CanvasDb } from './canvas.api'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-08-22T00:00:00.000Z'

function seedTaskProject(projectId: string, taskStatus: 'pending' | 'running' = 'running'): void {
  const db: CanvasDb = {
    projects: [
      {
        id: projectId,
        userId: 0,
        title: 'Task runtime project',
        status: 'active',
        rootPath: `/tmp/${projectId}`,
        settings: {},
        nodeCount: 1,
        assetCount: 0,
        taskCount: 1,
        createdAt: at,
        updatedAt: at,
      },
    ],
    boards: [
      {
        id: 'board-1',
        projectId,
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
        projectId,
        boardId: 'board-1',
        userId: 0,
        type: 'image_to_video',
        title: 'Video task',
        taskId: 'task-1',
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { operation: 'image_to_video', status: taskStatus, progress: 40 },
        createdAt: at,
        updatedAt: at,
      },
    ],
    edges: [],
    assets: [],
    tasks: [
      {
        id: 'task-1',
        projectId,
        boardId: 'board-1',
        userId: 0,
        operation: 'image_to_video',
        status: taskStatus,
        progress: 40,
        operationNodeId: 'operation-1',
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: [],
        outputAssetIds: [],
        modelParams: {},
        createdAt: at,
        updatedAt: at,
      },
    ],
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  __resetCanvasHotCache()
}

describe('canvas task runtime dirty handling', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({}) },
    })
  })

  it.each([
    ['failed', 'Provider task failed'],
    ['cancelled', 'Provider task cancelled'],
  ] as const)(
    'does not mark a clean project dirty when a provider task is %s',
    async (status, message) => {
      const projectId = `project-task-${status}`
      seedTaskProject(projectId)

      const snapshot = await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
        status,
        providerProfileId: 'provider-1',
        provider: 'test-provider',
        model: 'test-model',
        mode: 'async',
        assets: [],
        error: { code: status, message },
      })

      expect(snapshot.tasks[0]?.status).toBe(status)
      expect(snapshot.nodes[0]?.data.status).toBe(status)
      expect(isCanvasDirty(projectId)).toBe(false)
    },
  )

  it('does not clear an existing dirty state when runtime status is written back', async () => {
    const projectId = 'project-task-existing-dirty'
    seedTaskProject(projectId)
    await canvasApi.updateNodes(projectId, [
      {
        ...(await canvasApi.openSnapshot(projectId)).nodes[0]!,
        x: 120,
      },
    ])
    expect(isCanvasDirty(projectId)).toBe(true)

    await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
      status: 'failed',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      error: { code: 'task_failed', message: 'Provider task failed' },
    })

    expect(isCanvasDirty(projectId)).toBe(true)
  })

  it('does not mark a clean project dirty when the user cancels a task', async () => {
    const projectId = 'project-task-user-cancel'
    seedTaskProject(projectId)

    const snapshot = await canvasApi.cancelTask(projectId, 'task-1')

    expect(snapshot.tasks[0]?.status).toBe('cancelled')
    expect(isCanvasDirty(projectId)).toBe(false)
  })

  it('does not mark a clean project dirty when an async task enters running state', async () => {
    const projectId = 'project-task-submitted'
    seedTaskProject(projectId, 'pending')

    const snapshot = await canvasApi.markMediaTaskSubmitted(projectId, 'task-1', {
      status: 'running',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      message: 'Provider accepted task',
    })

    expect(snapshot.tasks[0]?.status).toBe('running')
    expect(isCanvasDirty(projectId)).toBe(false)
  })
})
