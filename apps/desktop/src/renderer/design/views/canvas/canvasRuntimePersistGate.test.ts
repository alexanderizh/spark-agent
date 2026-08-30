// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canvasApi,
  __resetCanvasHotCache,
  flushCanvasTaskRuntimeWrites,
  isCanvasDirty,
  revertProject,
  saveCanvas,
  type CanvasDb,
} from './canvas.api'
import { resolveCanvasOperationOutputState } from './canvasOperationOutputModel'
import { buildCanvasOperationMediaThumbnailItems } from './canvasOperationOutputThumbnails'
import { buildCanvasOperationRunViews } from './canvasOperationRuns'
import type { CanvasAsset, CanvasNode, CanvasTask } from './canvas.types'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-08-22T00:00:00.000Z'

function buildTaskEntities(
  projectId: string,
  taskId: string,
  index: number,
  taskStatus: 'pending' | 'running',
): { node: CanvasNode; task: CanvasTask } {
  const node: CanvasNode = {
    id: `operation-${index}`,
    projectId,
    boardId: 'board-1',
    userId: 0,
    type: 'image_to_video' as const,
    title: `Video task ${index}`,
    taskId,
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
  }
  const task: CanvasTask = {
    id: taskId,
    projectId,
    boardId: 'board-1',
    userId: 0,
    operation: 'image_to_video',
    status: taskStatus,
    progress: 40,
    operationNodeId: node.id,
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds: [],
    outputAssetIds: [],
    modelParams: {},
    createdAt: at,
    updatedAt: at,
  }
  return { node, task }
}

function seedTaskProject(
  projectId: string,
  taskIds: string[],
  taskStatus: 'pending' | 'running' = 'running',
): CanvasDb {
  const entities = taskIds.map((taskId, index) =>
    buildTaskEntities(projectId, taskId, index + 1, taskStatus),
  )
  const db: CanvasDb = {
    projects: [
      {
        id: projectId,
        userId: 0,
        title: 'Runtime persist project',
        status: 'active',
        rootPath: `/tmp/${projectId}`,
        settings: {},
        nodeCount: entities.length,
        assetCount: 0,
        taskCount: entities.length,
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
    nodes: entities.map((item) => item.node),
    edges: [],
    assets: [],
    tasks: entities.map((item) => item.task),
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  __resetCanvasHotCache()
  return db
}

function seedRepeatedRunProject(projectId: string): CanvasDb {
  const current = buildTaskEntities(projectId, 'task-current', 1, 'running')
  current.node.id = 'operation-shared'
  current.node.taskId = current.task.id
  current.task.operationNodeId = current.node.id
  current.task.createdAt = '2026-08-22T00:02:00.000Z'
  const historyTask: CanvasTask = {
    ...current.task,
    id: 'task-history',
    status: 'completed',
    progress: 100,
    outputAssetIds: ['asset-history-a', 'asset-history-b'],
    createdAt: '2026-08-22T00:01:00.000Z',
    completedAt: '2026-08-22T00:01:30.000Z',
  }
  const assets: CanvasAsset[] = ['a', 'b'].map((suffix) => ({
    id: `asset-history-${suffix}`,
    projectId,
    userId: 0,
    type: 'image',
    source: 'ai_generated',
    title: `历史产物 ${suffix.toUpperCase()}`,
    url: `https://example.com/history-${suffix}.png`,
    thumbnailUrl: `https://example.com/history-${suffix}.png`,
    metadata: { taskId: historyTask.id },
    createdAt: historyTask.completedAt!,
    updatedAt: historyTask.completedAt!,
  }))
  const db = seedTaskProject(projectId, [])
  db.nodes = [current.node]
  db.tasks = [current.task, historyTask]
  db.assets = assets
  db.projects[0]!.nodeCount = 1
  db.projects[0]!.taskCount = 2
  db.projects[0]!.assetCount = 2
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
  __resetCanvasHotCache()
  return db
}

/** 磁盘 latest.json 的快照形状（loadSnapshotFromStorage 的解析目标） */
function diskSnapshotOf(db: CanvasDb): Record<string, unknown> {
  return {
    project: db.projects[0],
    board: db.boards[0],
    boards: db.boards,
    activeBoardId: 'board-1',
    nodes: db.nodes,
    edges: db.edges,
    assets: db.assets,
    tasks: db.tasks,
  }
}

type InvokeMock = ReturnType<typeof vi.fn> & { savedSnapshots: string[] }

function installInvokeMock(options?: {
  staleDb?: CanvasDb
  saveDeferred?: () => Promise<unknown>
}): InvokeMock {
  const savedSnapshots: string[] = []
  const mock = vi.fn(async (channel: string, req: unknown): Promise<unknown> => {
    if (channel === 'canvas:snapshot:load') {
      // 磁盘语义：有落盘记录时返回最后一次保存内容，否则返回陈旧的 seed 快照。
      const latest = savedSnapshots[savedSnapshots.length - 1]
      const payload = latest ?? JSON.stringify(diskSnapshotOf(options?.staleDb ?? seedDbRef!))
      return { snapshotJson: payload }
    }
    if (channel === 'canvas:snapshot:save') {
      savedSnapshots.push((req as { snapshotJson: string }).snapshotJson)
      if (options?.saveDeferred) return options.saveDeferred()
      return { saved: true }
    }
    return {}
  })
  const decorated = Object.assign(mock, { savedSnapshots }) as InvokeMock
  Object.assign(window, { spark: { invoke: decorated } })
  return decorated
}

let seedDbRef: CanvasDb | null = null

describe('canvas task runtime silent persist gate', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps a failed terminal state when the stale disk snapshot would replace hot data', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-failed'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    installInvokeMock()

    const snapshot = await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
      status: 'failed',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      error: { code: 'task_failed', message: 'Provider task failed' },
    })
    expect(snapshot.tasks[0]?.status).toBe('failed')

    // 750ms 工作流轮询在静默落盘前到达：磁盘快照仍是 running，不得覆盖热数据。
    const polled = await canvasApi.openSnapshot(projectId)
    expect(polled.tasks[0]?.status).toBe('failed')
    expect(isCanvasDirty(projectId)).toBe(false)
  })

  it('keeps a cancelled task and a pending->running submit state against a stale disk snapshot', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-cancel'
    seedDbRef = seedTaskProject(projectId, ['task-1', 'task-2'], 'pending')
    installInvokeMock()

    const cancelled = await canvasApi.cancelTask(projectId, 'task-1')
    expect(cancelled.tasks.find((task) => task.id === 'task-1')?.status).toBe('cancelled')
    const polled = await canvasApi.openSnapshot(projectId)
    expect(polled.tasks.find((task) => task.id === 'task-1')?.status).toBe('cancelled')

    // 任务二提交进入 running：同样是运行态回写，也不得被磁盘旧 pending 快照覆盖。
    const resubmitted = await canvasApi.markMediaTaskSubmitted(projectId, 'task-2', {
      status: 'running',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      message: 'Provider accepted task',
    })
    expect(resubmitted.tasks.find((task) => task.id === 'task-2')?.status).toBe('running')
    const polledAgain = await canvasApi.openSnapshot(projectId)
    expect(polledAgain.tasks.find((task) => task.id === 'task-2')?.status).toBe('running')
    expect(isCanvasDirty(projectId)).toBe(false)
  })

  it('silently persists runtime writes and then resumes reading the fresh disk snapshot', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-persist'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    const invoke = installInvokeMock()

    await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
      status: 'failed',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      error: { code: 'task_failed', message: 'Provider task failed' },
    })

    await vi.advanceTimersByTimeAsync(1100)
    expect(invoke.savedSnapshots.length).toBeGreaterThanOrEqual(1)
    const saved = JSON.parse(invoke.savedSnapshots[invoke.savedSnapshots.length - 1]!) as {
      tasks: { status: string }[]
    }
    expect(saved.tasks[0]?.status).toBe('failed')
    expect(isCanvasDirty(projectId)).toBe(false)

    // 落盘完成后门闩解除：openSnapshot 恢复磁盘加载，读到的已是含终态的新快照。
    const polled = await canvasApi.openSnapshot(projectId)
    expect(polled.tasks[0]?.status).toBe('failed')
  })

  it('keeps the gate pending when a newer runtime write lands during the silent persist', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-race'
    seedDbRef = seedTaskProject(projectId, ['task-1', 'task-2'])
    let releaseSave: (value: unknown) => void = () => {}
    const invoke = installInvokeMock({
      saveDeferred: () => new Promise((resolve) => (releaseSave = resolve)),
    })

    await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
      status: 'failed',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      error: { code: 'task_failed', message: 'Provider task failed' },
    })

    // 触发静默落盘（IPC 挂起中）
    await vi.advanceTimersByTimeAsync(1100)
    expect(invoke.savedSnapshots.length).toBe(1)

    // 落盘在途时第二个任务终态写入：mutation 代次推进，本次落盘不得解除门闩。
    await canvasApi.cancelTask(projectId, 'task-2')

    const polled = await canvasApi.openSnapshot(projectId)
    expect(polled.tasks.find((task) => task.id === 'task-1')?.status).toBe('failed')
    expect(polled.tasks.find((task) => task.id === 'task-2')?.status).toBe('cancelled')

    // 第二次防抖在首个保存仍挂起时触发，不能被在途保存吞掉。
    await vi.advanceTimersByTimeAsync(1100)
    expect(invoke.savedSnapshots.length).toBe(1)
    releaseSave?.({ saved: true })
    await vi.advanceTimersByTimeAsync(0)

    // 首个保存发现 mutation 代次已变化后必须重新调度，第二次保存包含两个终态。
    await vi.advanceTimersByTimeAsync(1100)
    expect(invoke.savedSnapshots.length).toBe(2)
    const saved = JSON.parse(invoke.savedSnapshots[1]!) as {
      tasks: { id: string; status: string }[]
    }
    expect(saved.tasks.find((task) => task.id === 'task-1')?.status).toBe('failed')
    expect(saved.tasks.find((task) => task.id === 'task-2')?.status).toBe('cancelled')
    // 释放挂起的第二次 IPC，避免污染模块级 persistInFlight 串行化链影响后续用例。
    releaseSave?.({ saved: true })
    await vi.advanceTimersByTimeAsync(0)
  })

  it('a manual save also clears the gate and persists runtime writes', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-flush'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    const invoke = installInvokeMock()

    await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
      status: 'failed',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      error: { code: 'task_failed', message: 'Provider task failed' },
    })

    await expect(saveCanvas()).resolves.toBe(true)
    const saved = JSON.parse(invoke.savedSnapshots[invoke.savedSnapshots.length - 1]!) as {
      tasks: { status: string }[]
    }
    expect(saved.tasks[0]?.status).toBe('failed')

    // 全量落库已包含运行态：门闩解除，轮询读盘得到同样的终态。
    const polled = await canvasApi.openSnapshot(projectId)
    expect(polled.tasks[0]?.status).toBe('failed')
    expect(isCanvasDirty(projectId)).toBe(false)
  })

  it('persists only runtime fields from an already dirty project', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-dirty-before-runtime'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    const invoke = installInvokeMock()

    const initial = await canvasApi.openSnapshot(projectId)
    await canvasApi.updateNodes(projectId, [{ ...initial.nodes[0]!, x: 160 }])
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

    await vi.advanceTimersByTimeAsync(1100)
    expect(invoke.savedSnapshots).toHaveLength(1)
    const runtimeSaved = JSON.parse(invoke.savedSnapshots[0]!) as {
      nodes: { x: number }[]
      tasks: { status: string }[]
    }
    expect(runtimeSaved.nodes[0]?.x).toBe(0)
    expect(runtimeSaved.tasks[0]?.status).toBe('failed')
    expect(isCanvasDirty(projectId)).toBe(true)

    // 用户显式保存后，节点编辑才与已经持久化的任务终态一起进入磁盘快照。
    await expect(saveCanvas()).resolves.toBe(true)
    const saved = JSON.parse(invoke.savedSnapshots[1]!) as {
      nodes: { x: number }[]
      tasks: { status: string }[]
    }
    expect(saved.nodes[0]?.x).toBe(160)
    expect(saved.tasks[0]?.status).toBe('failed')
    expect(isCanvasDirty(projectId)).toBe(false)
  })

  it('falls back to runtime-only persistence when the project becomes dirty during debounce', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-dirty-during-debounce'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    const invoke = installInvokeMock()

    const failed = await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
      status: 'failed',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      error: { code: 'task_failed', message: 'Provider task failed' },
    })
    await canvasApi.updateNodes(projectId, [{ ...failed.nodes[0]!, x: 240 }])

    await vi.advanceTimersByTimeAsync(1100)
    expect(invoke.savedSnapshots).toHaveLength(1)
    const runtimeSaved = JSON.parse(invoke.savedSnapshots[0]!) as {
      nodes: { x: number }[]
      tasks: { status: string }[]
    }
    expect(runtimeSaved.nodes[0]?.x).toBe(0)
    expect(runtimeSaved.tasks[0]?.status).toBe('failed')
    expect(isCanvasDirty(projectId)).toBe(true)

    const hot = await canvasApi.openSnapshot(projectId)
    expect(hot.nodes[0]?.x).toBe(240)
    expect(hot.tasks[0]?.status).toBe('failed')
    expect(invoke).toHaveBeenCalledWith('canvas:snapshot:load', { projectId })
  })

  it('queues runtime-only persistence after an existing save without leaking later edits', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-dirty-while-waiting'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    let saveCallCount = 0
    let releaseFirstSave: (value: unknown) => void = () => {}
    const invoke = installInvokeMock({
      saveDeferred: () => {
        saveCallCount += 1
        if (saveCallCount > 1) return Promise.resolve({ saved: true })
        return new Promise((resolve) => (releaseFirstSave = resolve))
      },
    })

    // 先占住公共保存队列；任务终态随后进入 gate，并在防抖触发后等待这次保存。
    const existingSave = saveCanvas()
    await vi.advanceTimersByTimeAsync(0)
    expect(invoke.savedSnapshots).toHaveLength(1)
    await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
      status: 'failed',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      error: { code: 'task_failed', message: 'Provider task failed' },
    })
    await vi.advanceTimersByTimeAsync(1100)
    expect(invoke.savedSnapshots).toHaveLength(1)

    // gate 等待期间用户编辑节点：后续运行态合并不能偷写该编辑。
    const hot = await canvasApi.openSnapshot(projectId)
    await canvasApi.updateNodes(projectId, [{ ...hot.nodes[0]!, x: 360 }])
    expect(isCanvasDirty(projectId)).toBe(true)

    releaseFirstSave({ saved: true })
    await existingSave
    await vi.advanceTimersByTimeAsync(0)

    expect(invoke.savedSnapshots).toHaveLength(2)
    const runtimeSaved = JSON.parse(invoke.savedSnapshots[1]!) as {
      nodes: { x: number }[]
      tasks: { status: string }[]
    }
    expect(runtimeSaved.nodes[0]?.x).toBe(0)
    expect(runtimeSaved.tasks[0]?.status).toBe('failed')
    expect(isCanvasDirty(projectId)).toBe(true)

    const current = await canvasApi.openSnapshot(projectId)
    expect(current.nodes[0]?.x).toBe(360)
    expect(current.tasks[0]?.status).toBe('failed')
  })

  it('keeps a later full save behind an in-flight runtime baseline merge', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-runtime-before-full-save'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    const staleSnapshotJson = JSON.stringify(diskSnapshotOf(seedDbRef))
    installInvokeMock()
    const initial = await canvasApi.openSnapshot(projectId)
    await canvasApi.updateNodes(projectId, [{ ...initial.nodes[0]!, x: 640 }])

    const savedSnapshots: string[] = []
    let releaseLoad: (() => void) | undefined
    const invoke = vi.fn((channel: string, request: unknown): Promise<unknown> => {
      if (channel === 'canvas:snapshot:load') {
        return new Promise((resolve) => {
          releaseLoad = () => resolve({ snapshotJson: staleSnapshotJson })
        })
      }
      if (channel === 'canvas:snapshot:save') {
        savedSnapshots.push((request as { snapshotJson: string }).snapshotJson)
        return Promise.resolve({ saved: true })
      }
      return Promise.resolve({})
    })
    Object.assign(window, { spark: { invoke } })
    await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
      status: 'failed',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [],
      error: { code: 'task_failed', message: 'Provider task failed' },
    })

    await vi.advanceTimersByTimeAsync(1100)
    expect(releaseLoad).toBeTypeOf('function')
    const saving = saveCanvas()
    await vi.advanceTimersByTimeAsync(0)
    expect(savedSnapshots).toHaveLength(0)

    releaseLoad?.()
    await expect(saving).resolves.toBe(true)
    expect(savedSnapshots).toHaveLength(2)
    const runtimeSaved = JSON.parse(savedSnapshots[0]!) as {
      nodes: { x: number }[]
      tasks: { status: string }[]
    }
    const fullySaved = JSON.parse(savedSnapshots[1]!) as {
      nodes: { x: number }[]
      tasks: { status: string }[]
    }
    expect(runtimeSaved.nodes[0]?.x).toBe(0)
    expect(runtimeSaved.tasks[0]?.status).toBe('failed')
    expect(fullySaved.nodes[0]?.x).toBe(640)
    expect(fullySaved.tasks[0]?.status).toBe('failed')
    expect(isCanvasDirty(projectId)).toBe(false)
  })

  it('flushes a cancellation before discarding dirty edits without waiting for debounce', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-discard-after-cancel'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    const invoke = installInvokeMock()

    const initial = await canvasApi.openSnapshot(projectId)
    await canvasApi.updateNodes(projectId, [{ ...initial.nodes[0]!, x: 480 }])
    await canvasApi.cancelTask(projectId, 'task-1')
    expect(isCanvasDirty(projectId)).toBe(true)

    await revertProject(projectId)

    expect(invoke.savedSnapshots).toHaveLength(1)
    const reverted = await canvasApi.openSnapshot(projectId)
    expect(reverted.nodes[0]?.x).toBe(0)
    expect(reverted.nodes[0]?.data.status).toBe('cancelled')
    expect(reverted.tasks[0]?.status).toBe('cancelled')
    expect(isCanvasDirty(projectId)).toBe(false)
  })

  it('does not restore a deleted active run as running when dirty edits are discarded', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-delete-active-run'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    installInvokeMock()

    const initial = await canvasApi.openSnapshot(projectId)
    const operationNode = initial.nodes[0]
    if (!operationNode) throw new Error('operation node missing')
    await canvasApi.updateNodes(projectId, [{ ...operationNode, x: 480 }])
    await canvasApi.cancelTask(projectId, 'task-1')
    await flushCanvasTaskRuntimeWrites(projectId)
    canvasApi.deleteTasks(projectId, ['task-1'])

    const deleted = await canvasApi.openSnapshot(projectId)
    expect(deleted.tasks).toHaveLength(0)

    await revertProject(projectId)
    const reverted = await canvasApi.openSnapshot(projectId)
    expect(reverted.tasks).toHaveLength(1)
    expect(reverted.tasks[0]?.status).toBe('cancelled')
    expect(reverted.nodes[0]?.data.status).toBe('cancelled')
    expect(isCanvasDirty(projectId)).toBe(false)
  })

  it('keeps completed outputs while discarding unrelated dirty edits', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-discard-after-complete'
    seedDbRef = seedTaskProject(projectId, ['task-1'])
    const invoke = installInvokeMock()

    const initial = await canvasApi.openSnapshot(projectId)
    await canvasApi.updateNodes(projectId, [{ ...initial.nodes[0]!, x: 480 }])
    const completed = await canvasApi.applyMediaTaskResult(projectId, 'task-1', {
      status: 'succeeded',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [
        {
          type: 'image',
          url: 'https://example.com/completed-output.png',
          width: 512,
          height: 512,
        },
      ],
    })
    expect(completed.tasks[0]?.status).toBe('completed')
    expect(completed.tasks[0]?.outputAssetIds).toHaveLength(1)
    expect(isCanvasDirty(projectId)).toBe(true)

    await vi.advanceTimersByTimeAsync(1100)
    expect(invoke.savedSnapshots).toHaveLength(1)
    const runtimeSaved = JSON.parse(invoke.savedSnapshots[0]!) as {
      nodes: { x: number }[]
      tasks: { status: string; outputAssetIds: string[] }[]
      assets: { id: string }[]
    }
    expect(runtimeSaved.nodes[0]?.x).toBe(0)
    expect(runtimeSaved.tasks[0]).toMatchObject({
      status: 'completed',
      outputAssetIds: [runtimeSaved.assets[0]?.id],
    })

    await revertProject(projectId)
    const reverted = await canvasApi.openSnapshot(projectId)
    expect(reverted.nodes[0]?.x).toBe(0)
    expect(reverted.tasks[0]?.status).toBe('completed')
    expect(reverted.tasks[0]?.outputAssetIds).toHaveLength(1)
    expect(reverted.assets).toHaveLength(1)
    expect(isCanvasDirty(projectId)).toBe(false)
  })

  it('persists cancellation without losing outputs from earlier runs after reopening', async () => {
    vi.useFakeTimers()
    const projectId = 'project-gate-history'
    seedDbRef = seedRepeatedRunProject(projectId)
    const invoke = installInvokeMock()

    const cancelled = await canvasApi.cancelTask(projectId, 'task-current')
    expect(cancelled.tasks.find((task) => task.id === 'task-current')?.status).toBe('cancelled')
    expect(cancelled.assets.map((asset) => asset.id)).toEqual([
      'asset-history-a',
      'asset-history-b',
    ])

    await vi.advanceTimersByTimeAsync(1100)
    expect(invoke.savedSnapshots).toHaveLength(1)

    // 模拟退出后重新进入：清空 renderer 热缓存，下一次 openSnapshot 必须从落盘快照
    // 恢复 cancelled 终态和历史多产物，而不是旧 running。
    __resetCanvasHotCache()
    const reopened = await canvasApi.openSnapshot(projectId)
    expect(reopened.tasks.find((task) => task.id === 'task-current')?.status).toBe('cancelled')
    expect(reopened.assets.map((asset) => asset.id)).toEqual(['asset-history-a', 'asset-history-b'])

    const operation = reopened.nodes.find((node) => node.id === 'operation-shared')!
    const runs = buildCanvasOperationRunViews(operation, reopened)
    const outputState = resolveCanvasOperationOutputState(operation, runs)
    expect(outputState).toMatchObject({
      primaryRun: { taskId: 'task-history', status: 'completed' },
      primaryOutput: { assetId: 'asset-history-a' },
    })
    // 当前 run 已取消也不影响节点选中后的底部历史画廊；两个旧媒体产物仍可切换。
    expect(buildCanvasOperationMediaThumbnailItems(runs).map((item) => item.output.id)).toEqual([
      'asset-history-a',
      'asset-history-b',
    ])
  })

  it('rejects an in-flight stale disk load after one task completes and another starts', async () => {
    vi.useFakeTimers()
    const projectId = 'project-in-flight-load-race'
    seedDbRef = seedTaskProject(projectId, ['task-a'])
    const staleSnapshotJson = JSON.stringify(diskSnapshotOf(seedDbRef))
    let releaseLoad: (() => void) | undefined
    const invoke = vi.fn((channel: string, request: unknown): Promise<unknown> => {
      if (channel === 'canvas:snapshot:load') {
        return new Promise((resolve) => {
          releaseLoad = () => resolve({ snapshotJson: staleSnapshotJson })
        })
      }
      if (channel === 'canvas:snapshot:save') {
        return Promise.resolve({
          saved: true,
          snapshotJson: (request as { snapshotJson: string }).snapshotJson,
        })
      }
      return Promise.resolve({})
    })
    Object.assign(window, { spark: { invoke } })

    // 750ms 轮询先发起磁盘读取，但此时磁盘里的 A 仍是 running。
    const staleLoad = canvasApi.openSnapshot(projectId)
    expect(releaseLoad).toBeTypeOf('function')

    // 旧读取尚未返回时，A 已完成并生成产物，用户紧接着启动 B。
    const completedA = await canvasApi.applyMediaTaskResult(projectId, 'task-a', {
      status: 'succeeded',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [
        {
          type: 'image',
          url: 'https://example.com/task-a.png',
          width: 128,
          height: 128,
        },
      ],
    })
    const completedTaskA = completedA.tasks.find((task) => task.id === 'task-a')
    expect(completedTaskA?.status).toBe('completed')
    expect(completedTaskA?.outputAssetIds).toHaveLength(1)

    const afterStartingB = await canvasApi.createTask(projectId, {
      boardId: 'board-1',
      operation: 'text_to_image',
      prompt: 'start task B',
      inputNodeIds: [],
      inputAssetIds: [],
    })
    expect(afterStartingB.tasks).toHaveLength(2)

    // 模拟自动保存先完成：即便项目此刻已恢复 clean，代次也必须让更早发起的 load 失效。
    await expect(saveCanvas()).resolves.toBe(true)
    expect(isCanvasDirty(projectId)).toBe(false)

    // 旧盘读取最后返回：不得整库覆盖 A 的终态/产物和刚创建的 B。
    releaseLoad?.()
    const resolved = await staleLoad
    const taskA = resolved.tasks.find((task) => task.id === 'task-a')
    expect(taskA?.status).toBe('completed')
    expect(taskA?.outputAssetIds).toEqual(completedTaskA?.outputAssetIds)
    expect(resolved.assets).toHaveLength(1)
    expect(resolved.tasks).toHaveLength(2)
  })

  it('rejects an in-flight full hydration after one task completes and another starts', async () => {
    vi.useFakeTimers()
    const projectId = 'project-in-flight-hydration-race'
    seedDbRef = seedTaskProject(projectId, ['task-a'])
    const staleSnapshotJson = JSON.stringify(diskSnapshotOf(seedDbRef))
    const savedSnapshots: string[] = []
    let loadCallCount = 0
    let releaseHydrationLoad: (() => void) | undefined
    const invoke = vi.fn((channel: string, request: unknown): Promise<unknown> => {
      if (channel === 'canvas:project:list') {
        return Promise.resolve({ projects: seedDbRef!.projects })
      }
      if (channel === 'canvas:snapshot:load') {
        loadCallCount += 1
        if (loadCallCount === 1) {
          return new Promise((resolve) => {
            releaseHydrationLoad = () => resolve({ snapshotJson: staleSnapshotJson })
          })
        }
        return Promise.resolve({
          snapshotJson: savedSnapshots[savedSnapshots.length - 1] ?? staleSnapshotJson,
        })
      }
      if (channel === 'canvas:snapshot:save') {
        savedSnapshots.push((request as { snapshotJson: string }).snapshotJson)
        return Promise.resolve({ saved: true })
      }
      return Promise.resolve({})
    })
    Object.assign(window, { spark: { invoke } })

    // 项目列表刷新先进入全库 hydrate，并挂起在旧磁盘快照读取上。
    const hydration = canvasApi.hydrateFromStorage()
    await vi.advanceTimersByTimeAsync(0)
    expect(releaseHydrationLoad).toBeTypeOf('function')

    const completedA = await canvasApi.applyMediaTaskResult(projectId, 'task-a', {
      status: 'succeeded',
      providerProfileId: 'provider-1',
      provider: 'test-provider',
      model: 'test-model',
      mode: 'async',
      assets: [
        {
          type: 'image',
          url: 'https://example.com/task-a.png',
          width: 128,
          height: 128,
        },
      ],
    })
    const completedTaskA = completedA.tasks.find((task) => task.id === 'task-a')
    const afterStartingB = await canvasApi.createTask(projectId, {
      boardId: 'board-1',
      operation: 'text_to_image',
      prompt: 'start task B',
      inputNodeIds: [],
      inputAssetIds: [],
    })
    expect(afterStartingB.tasks).toHaveLength(2)
    await expect(saveCanvas()).resolves.toBe(true)
    expect(isCanvasDirty(projectId)).toBe(false)

    // 更早的全库读取最后返回；即使当前已 clean，也必须因 mutation 代次变化放弃提交。
    releaseHydrationLoad?.()
    await expect(hydration).resolves.toEqual({ restored: 0 })

    const current = await canvasApi.openSnapshot(projectId)
    const taskA = current.tasks.find((task) => task.id === 'task-a')
    expect(taskA?.status).toBe('completed')
    expect(taskA?.outputAssetIds).toEqual(completedTaskA?.outputAssetIds)
    expect(current.assets).toHaveLength(1)
    expect(current.tasks).toHaveLength(2)
  })
})
