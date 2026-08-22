// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canvasApi, __resetCanvasHotCache } from './canvas.api'
import type { CanvasDb } from './canvas.api'
import type { CanvasEdge, CanvasNode, CanvasTask } from './canvas.types'
import { buildCanvasOperationRunViews } from './canvasOperationRuns'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-07-23T00:00:00.000Z'

function node(
  id: string,
  type: CanvasNode['type'],
  overrides: Partial<CanvasNode> = {},
): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    type,
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  type: CanvasEdge['type'],
  taskId: string | null = null,
): CanvasEdge {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    sourceNodeId,
    targetNodeId,
    type,
    taskId,
    metadata: {},
    createdAt: at,
  }
}

function task(): CanvasTask {
  return {
    id: 'task-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    operation: 'text_to_image',
    status: 'completed',
    progress: 100,
    operationNodeId: 'operation-1',
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds: ['embedded-output'],
    outputAssetIds: ['asset-1'],
    modelParams: {},
    createdAt: at,
    updatedAt: at,
    completedAt: at,
  }
}

function seedDb(): void {
  const operation = node('operation-1', 'text_to_image', {
    taskId: 'task-1',
    data: { operation: 'text_to_image', status: 'completed' },
  })
  const embeddedOutput = node('embedded-output', 'image', {
    assetId: 'asset-1',
    data: { origin: 'task_output', url: 'https://example.com/output.png' },
  })
  const expandedReference = node('expanded-reference', 'image', {
    assetId: 'asset-1',
    x: 400,
    data: {
      origin: 'asset',
      url: 'https://example.com/output.png',
      materializedOutput: {
        operationNodeId: operation.id,
        outputId: embeddedOutput.id,
        materializedAt: at,
      },
    },
  })
  const db: CanvasDb = {
    projects: [
      {
        id: 'project-1',
        userId: 0,
        title: 'Project',
        status: 'active',
        rootPath: '/tmp/project-1',
        settings: {},
        nodeCount: 3,
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
    nodes: [operation, embeddedOutput, expandedReference],
    edges: [
      edge('generated-edge', operation.id, embeddedOutput.id, 'generated', 'task-1'),
      edge('expanded-reference-edge', operation.id, expandedReference.id, 'references'),
    ],
    assets: [
      {
        id: 'asset-1',
        projectId: 'project-1',
        userId: 0,
        type: 'image',
        source: 'ai_generated',
        title: 'Output',
        url: 'https://example.com/output.png',
        metadata: { taskId: 'task-1' },
        createdAt: at,
        updatedAt: at,
      },
    ],
    tasks: [task()],
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db))
}

describe('canvas node deletion', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
    vi.stubGlobal('window', window)
    Object.assign(window, {
      spark: { invoke: vi.fn().mockResolvedValue({ rootPath: '/tmp/project-1' }) },
    })
    seedDb()
  })

  it('deletes outputs still embedded in an operation while preserving expanded references', async () => {
    await canvasApi.deleteNodes('project-1', ['operation-1'])

    const snapshot = await canvasApi.openSnapshot('project-1')
    expect(snapshot.nodes.map((item) => item.id)).toEqual(['expanded-reference'])
    expect(snapshot.edges).toEqual([])
    expect(snapshot.tasks).toEqual([])
    expect(snapshot.assets.map((item) => item.id)).toEqual(['asset-1'])
  })

  it('clears task outputAssetIds when deleting output nodes so ghost outputs do not reappear', async () => {
    // 只删产物节点（不删操作节点）：task 应保留，但其 outputNodeIds / outputAssetIds
    // 必须同步清空，否则 collectOutputs 会仅凭残留 assetId 把已删产物重新投影成无 nodeId 的幽灵。
    await canvasApi.deleteNodes('project-1', ['embedded-output'])

    const snapshot = await canvasApi.openSnapshot('project-1')
    const task = snapshot.tasks.find((item) => item.id === 'task-1')
    expect(task).toBeTruthy()
    expect(task!.outputNodeIds).toEqual([])
    expect(task!.outputAssetIds).toEqual([])

    const operation = snapshot.nodes.find((item) => item.id === 'operation-1')!
    const runs = buildCanvasOperationRunViews(operation, snapshot)
    expect(runs.flatMap((run) => run.outputs)).toEqual([])
  })

  it('persists asset-only output deletion while retaining the resource asset', async () => {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const seeded = JSON.parse(raw!) as CanvasDb
    const operation = seeded.nodes.find((item) => item.id === 'operation-1')!
    operation.data.primaryOutputId = 'asset-1'
    operation.data.primaryOutputSelection = 'manual'
    seeded.nodes = [operation]
    seeded.edges = []
    seeded.tasks[0]!.outputNodeIds = []
    seeded.tasks[0]!.outputAssetIds = ['asset-1']
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    __resetCanvasHotCache()

    const { result } = await canvasApi.deleteOperationOutputs('project-1', {
      operationNodeId: operation.id,
      outputs: [
        {
          id: 'asset-1',
          taskId: 'task-1',
          assetId: 'asset-1',
          type: 'image',
          title: 'Output',
          createdAt: at,
          updatedAt: at,
        },
      ],
    })

    const snapshot = await canvasApi.openSnapshot('project-1')
    expect(result).toEqual({
      deletedOutputCount: 1,
      deletedNodeCount: 0,
      deletedTaskCount: 1,
      skippedOutputCount: 0,
    })
    expect(snapshot.tasks).toEqual([])
    expect(snapshot.assets.map((item) => item.id)).toEqual(['asset-1'])
    expect(snapshot.nodes[0]?.data.primaryOutputId).toBeUndefined()
    expect(snapshot.nodes[0]?.data.primaryOutputSelection).toBe('auto_latest')
  })

  it('never dispatches cleanup-files IPC when deleting nodes, even if they carry source files', async () => {
    // 画布内删节点是软删（hidden=true，可撤销），刻意不清理源文件：
    // 同一素材可能仍被其它节点/分镜引用；资产管理入口会在节点软删后
    // 另行调用 deleteFilmAsset({ hardDelete: true }) 清理源文件。
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const seeded = JSON.parse(raw!) as CanvasDb
    seeded.nodes.push(
      node('provider-source', 'image', {
        data: { url: 'https://example.com/p.png', providerProfileId: 'profile-x', fileId: 'pf-1' },
      }),
      node('local-source', 'image', {
        data: { url: 'safe-file:///tmp/local.png', filePath: '/tmp/canvas-media/local.png' },
      }),
    )
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    __resetCanvasHotCache()

    const invokeMock = window.spark.invoke as unknown as ReturnType<typeof vi.fn>
    invokeMock.mockClear()

    await canvasApi.deleteNodes('project-1', ['provider-source', 'local-source'])
    // 让潜在的 fire-and-forget 微任务落定后再断言
    await new Promise((resolve) => setImmediate(resolve))

    const cleanupCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'canvas:asset:cleanup-files',
    )
    expect(cleanupCalls.length).toBe(0)
  })

  it('cleans asset source files only when deleteFilmAsset is called with hardDelete', async () => {
    // 管理类资产入口走 hardDelete=true → 清源文件；Agent 等治理调用
    // 不传该选项 → 只移除引用。
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const seeded = JSON.parse(raw!) as CanvasDb
    seeded.assets.push(
      {
        id: 'asset-soft',
        projectId: 'project-1',
        userId: 0,
        type: 'image',
        source: 'upload',
        title: 'Soft',
        url: 'https://example.com/soft.png',
        storageKey: '/tmp/project-1/soft.png',
        metadata: {},
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'asset-hard',
        projectId: 'project-1',
        userId: 0,
        type: 'image',
        source: 'upload',
        title: 'Hard',
        url: 'https://example.com/hard.png',
        storageKey: '/tmp/project-1/hard.png',
        metadata: { providerProfileId: 'profile-x', fileId: 'pf-1' },
        createdAt: at,
        updatedAt: at,
      },
    )
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    __resetCanvasHotCache()

    const invokeMock = window.spark.invoke as unknown as ReturnType<typeof vi.fn>
    invokeMock.mockClear()

    await canvasApi.deleteFilmAsset('project-1', 'asset-soft')
    await new Promise((resolve) => setImmediate(resolve))
    expect(
      invokeMock.mock.calls.filter((call) => call[0] === 'canvas:asset:cleanup-files').length,
    ).toBe(0)

    await canvasApi.deleteFilmAsset('project-1', 'asset-hard', { hardDelete: true })
    await new Promise((resolve) => setImmediate(resolve))

    const cleanupCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'canvas:asset:cleanup-files',
    )
    expect(cleanupCalls.length).toBe(1)
    const payload = cleanupCalls[0]?.[1] as {
      providerFiles: Array<{ providerProfileId: string; fileId: string }>
      localPaths: string[]
    }
    expect(payload.providerFiles).toEqual([{ providerProfileId: 'profile-x', fileId: 'pf-1' }])
    expect(payload.localPaths).toEqual(['/tmp/project-1/hard.png'])
  })

  it('cleans manuscript and chapter source files when hard deleting a manuscript', async () => {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const seeded = JSON.parse(raw!) as CanvasDb
    seeded.assets.push(
      {
        id: 'manuscript-1',
        projectId: 'project-1',
        userId: 0,
        type: 'file',
        source: 'manual',
        title: 'Manuscript',
        storageKey: '/tmp/project-1/manuscript.txt',
        metadata: { kind: 'manuscript' },
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'chapter-1',
        projectId: 'project-1',
        userId: 0,
        type: 'file',
        source: 'manual',
        title: 'Chapter 1',
        metadata: { kind: 'chapter', manuscriptId: 'manuscript-1' },
        storageKey: '/tmp/project-1/chapter-1.txt',
        createdAt: at,
        updatedAt: at,
      },
    )
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    __resetCanvasHotCache()

    const invokeMock = window.spark.invoke as unknown as ReturnType<typeof vi.fn>
    invokeMock.mockClear()

    const result = await canvasApi.deleteManuscript('project-1', 'manuscript-1', {
      hardDelete: true,
    })
    await new Promise((resolve) => setImmediate(resolve))

    expect(result.deletedChapters).toBe(1)
    const cleanupCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'canvas:asset:cleanup-files',
    )
    expect(cleanupCalls).toHaveLength(2)
    expect(
      cleanupCalls.map((call) => (call[1] as { localPaths: string[] }).localPaths[0]).sort(),
    ).toEqual(['/tmp/project-1/chapter-1.txt', '/tmp/project-1/manuscript.txt'])
  })
})
