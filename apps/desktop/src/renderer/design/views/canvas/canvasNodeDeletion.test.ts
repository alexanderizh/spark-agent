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
})
