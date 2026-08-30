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

  it('deletes an expanded reference without changing the original task output', async () => {
    await canvasApi.deleteNodes('project-1', ['expanded-reference'])

    const snapshot = await canvasApi.openSnapshot('project-1')
    expect(snapshot.nodes.map((item) => item.id)).toEqual(['operation-1', 'embedded-output'])
    expect(snapshot.edges.map((item) => item.id)).toEqual(['generated-edge'])
    expect(snapshot.tasks).toHaveLength(1)
    expect(snapshot.tasks[0]?.outputNodeIds).toEqual(['embedded-output'])
    expect(snapshot.tasks[0]?.outputAssetIds).toEqual(['asset-1'])

    const operation = snapshot.nodes.find((item) => item.id === 'operation-1')!
    expect(buildCanvasOperationRunViews(operation, snapshot)[0]?.outputs[0]).toMatchObject({
      nodeId: 'embedded-output',
      assetId: 'asset-1',
    })
  })

  it('keeps an asset-only task output when its expanded reference is deleted', async () => {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const seeded = JSON.parse(raw!) as CanvasDb
    seeded.nodes = seeded.nodes.filter((item) => item.id !== 'embedded-output')
    seeded.edges = seeded.edges.filter((item) => item.id !== 'generated-edge')
    seeded.tasks[0]!.outputNodeIds = []
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    __resetCanvasHotCache()

    await canvasApi.deleteNodes('project-1', ['expanded-reference'])

    const snapshot = await canvasApi.openSnapshot('project-1')
    expect(snapshot.tasks[0]?.outputNodeIds).toEqual([])
    expect(snapshot.tasks[0]?.outputAssetIds).toEqual(['asset-1'])
    const operation = snapshot.nodes.find((item) => item.id === 'operation-1')!
    expect(buildCanvasOperationRunViews(operation, snapshot)[0]?.outputs).toEqual([
      expect.objectContaining({ id: 'asset-1', assetId: 'asset-1' }),
    ])
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

  it('reclaims the asset usage count when soft-deleting a referencing node', async () => {
    // 缺陷 1：删节点必须回收资产引用计数；重复删除（已隐藏）不得重复递减。
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const seeded = JSON.parse(raw!) as CanvasDb
    seeded.assets[0]!.metadata = { ...seeded.assets[0]!.metadata, usageCount: 2 }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    __resetCanvasHotCache()

    await canvasApi.deleteNodes('project-1', ['expanded-reference'])
    const snapshot = await canvasApi.openSnapshot('project-1')
    expect(snapshot.assets[0]?.metadata.usageCount).toBe(1)

    // 已隐藏节点再次删除：不重复递减
    await canvasApi.deleteNodes('project-1', ['expanded-reference'])
    const again = await canvasApi.openSnapshot('project-1')
    expect(again.assets[0]?.metadata.usageCount).toBe(1)
  })

  it('excludes soft-deleted nodes from asset usage stats and reference lookup', async () => {
    // 缺陷 1：统计口径过滤 hidden 软删节点，与下载/渲染口径一致。
    await canvasApi.deleteNodes('project-1', ['expanded-reference'])

    const usage = canvasApi.countFilmAssetUsage('project-1')
    expect(usage.get('asset-1')).toBe(1)

    const detail = canvasApi.getFilmAssetUsage('project-1', 'asset-1')
    expect(detail.nodes.map((node) => node.id)).toEqual(['embedded-output'])

    // 引用节点也软删后计数归零（无引用时 Map 无键，按 0 计）
    await canvasApi.deleteNodes('project-1', ['embedded-output'])
    expect(canvasApi.countFilmAssetUsage('project-1').get('asset-1') ?? 0).toBe(0)
    expect(canvasApi.getFilmAssetUsage('project-1', 'asset-1').nodes).toEqual([])
  })

  it('reclaims the asset usage count when deleting a board (same rule as deleteNodes)', async () => {
    // 缺陷 1 口径一致性：deleteBoard 软删 board 名下全部节点，同样必须回收引用计数。
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const seeded = JSON.parse(raw!) as CanvasDb
    seeded.assets[0]!.metadata = { ...seeded.assets[0]!.metadata, usageCount: 2 }
    seeded.boards.push({
      id: 'board-2',
      projectId: 'project-1',
      userId: 0,
      name: 'Board 2',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    })
    const expandedReference = seeded.nodes.find((item) => item.id === 'expanded-reference')
    expect(expandedReference).toBeTruthy()
    expandedReference!.boardId = 'board-2'
    expandedReference!.assetId = 'asset-1'
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    __resetCanvasHotCache()

    await canvasApi.deleteBoard('project-1', 'board-2')

    const snapshot = await canvasApi.openSnapshot('project-1')
    // board-2 名下唯一引用节点被软删 → usageCount 2 → 1
    expect(snapshot.assets[0]?.metadata.usageCount).toBe(1)
    // 统计口径同步：引用查询不再计入已软删节点，仅剩 board-1 内的嵌入引用
    expect(canvasApi.getFilmAssetUsage('project-1', 'asset-1').nodes).toEqual([
      expect.objectContaining({ id: 'embedded-output' }),
    ])
  })

  it('batch-deletes assets with a single cleanup IPC and cascades referencing nodes', async () => {
    // 缺陷 4：一次遍历收集清理请求 + 单次 IPC；引用节点级联软删。
    // asset-del-1 故意使用相对 storageKey（P1 起新写入形态），验证读取端按项目根目录解析。
    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    const seeded = JSON.parse(raw!) as CanvasDb
    seeded.assets.push(
      {
        id: 'asset-del-1',
        projectId: 'project-1',
        userId: 0,
        type: 'image',
        source: 'upload',
        title: 'Del 1',
        storageKey: 'assets/images/del-1.png',
        metadata: {},
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'asset-del-2',
        projectId: 'project-1',
        userId: 0,
        type: 'image',
        source: 'upload',
        title: 'Del 2',
        metadata: { providerProfileId: 'profile-x', fileId: 'pf-2' },
        createdAt: at,
        updatedAt: at,
      },
      {
        id: 'asset-keep',
        projectId: 'project-1',
        userId: 0,
        type: 'image',
        source: 'upload',
        title: 'Keep',
        storageKey: '/tmp/project-1/keep.png',
        metadata: {},
        createdAt: at,
        updatedAt: at,
      },
    )
    const expandedReference = seeded.nodes.find((item) => item.id === 'expanded-reference')
    expect(expandedReference).toBeTruthy()
    expandedReference!.assetId = 'asset-del-1'
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
    __resetCanvasHotCache()

    const invokeMock = window.spark.invoke as unknown as ReturnType<typeof vi.fn>
    invokeMock.mockClear()

    const result = await canvasApi.batchDeleteFilmAssets(
      'project-1',
      ['asset-del-1', 'asset-del-2', 'asset-missing'],
      { hardDelete: true },
    )
    // 让 fire-and-forget 清理微任务落定后再断言
    await new Promise((resolve) => setImmediate(resolve))

    expect(result.deletedAssetIds.sort()).toEqual(['asset-del-1', 'asset-del-2'])
    expect(result.missingAssetIds).toEqual(['asset-missing'])
    expect(result.removedNodeIds).toEqual(['expanded-reference'])

    const snapshot = await canvasApi.openSnapshot('project-1')
    expect(snapshot.assets.map((item) => item.id).sort()).toEqual(['asset-1', 'asset-keep'])
    expect(snapshot.nodes.find((item) => item.id === 'expanded-reference')).toBeUndefined()

    // 单次清理 IPC：相对 storageKey 已解析回项目内绝对路径，provider 文件跨资产去重
    const cleanupCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'canvas:asset:cleanup-files',
    )
    expect(cleanupCalls).toHaveLength(1)
    expect(cleanupCalls[0]?.[1]).toEqual({
      providerFiles: [{ providerProfileId: 'profile-x', fileId: 'pf-2' }],
      localPaths: ['/tmp/project-1/assets/images/del-1.png'],
    })
  })

  it('writes project-relative storage keys for assets created inside the project root', async () => {
    // 缺陷 3：项目目录内的新写入一律存相对 key；metadata.filePath 保留绝对路径兜底。
    const file = new File(['x'], 'inside.png', { type: 'image/png' })
    const inside = await canvasApi.createImageAsset({
      projectId: 'project-1',
      file,
      filePath: '/tmp/project-1/assets/images/inside.png',
      imageWidth: 10,
      imageHeight: 10,
    })
    expect(inside.storageKey).toBe('assets/images/inside.png')
    expect(inside.metadata.filePath).toBe('/tmp/project-1/assets/images/inside.png')

    // 项目目录外的文件无法相对化，保持绝对路径
    const outside = await canvasApi.createImageAsset({
      projectId: 'project-1',
      file,
      filePath: '/tmp/elsewhere/outside.png',
      imageWidth: 10,
      imageHeight: 10,
    })
    expect(outside.storageKey).toBe('/tmp/elsewhere/outside.png')
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
    // 批量清理合并为单次 IPC（缺陷 4）：一次收集全部本地路径，不再逐资产调用
    const cleanupCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === 'canvas:asset:cleanup-files',
    )
    expect(cleanupCalls).toHaveLength(1)
    expect((cleanupCalls[0]?.[1] as { localPaths: string[] }).localPaths.sort()).toEqual([
      '/tmp/project-1/chapter-1.txt',
      '/tmp/project-1/manuscript.txt',
    ])
  })
})
