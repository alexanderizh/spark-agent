import { describe, expect, it } from 'vitest'
import {
  collectCanvasOperationImageAssets,
  inferCanvasOperationOutputMode,
  resolveCanvasOperationInputNodes,
  resolveCanvasOperationOutputState,
  resolveCanvasOperationResourceNode,
  selectCanvasOperationOutputs,
} from './canvasOperationOutputModel'
import { buildCanvasOperationRunViews } from './canvasOperationRuns'
import { expandCanvasInputNodes } from './canvasWorkspaceTaskInput'
import type { CanvasAsset, CanvasNode, CanvasSnapshot, CanvasTask } from './canvas.types'

const at = '2026-07-10T00:00:00.000Z'

function operationNode(data: CanvasNode['data'] = {}): CanvasNode {
  return {
    id: 'operation-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text_to_image',
    taskId: 'task-2',
    x: 0,
    y: 0,
    width: 320,
    height: 260,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { operation: 'text_to_image', status: 'completed', ...data },
    createdAt: at,
    updatedAt: at,
  }
}

function outputNode(id: string, assetId: string, title: string): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'image',
    assetId,
    title,
    x: 380,
    y: 0,
    width: 320,
    height: 180,
    rotation: 0,
    zIndex: 2,
    locked: false,
    hidden: false,
    data: { url: `https://example.com/${id}.png`, origin: 'task_output' },
    createdAt: at,
    updatedAt: at,
  }
}

function asset(id: string, title: string, type: CanvasAsset['type'] = 'image'): CanvasAsset {
  return {
    id,
    projectId: 'project-1',
    userId: 1,
    type,
    source: 'ai_generated',
    title,
    ...(type === 'text'
      ? { contentText: `${title}正文` }
      : { url: `https://example.com/${id}.png`, width: 1280, height: 720 }),
    metadata: {},
    createdAt: at,
    updatedAt: at,
  }
}

function task(
  id: string,
  outputNodeIds: string[],
  outputAssetIds: string[],
  workflow?: string,
): CanvasTask {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    operation: 'text_to_image',
    status: 'completed',
    progress: 100,
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds,
    outputAssetIds,
    modelParams: workflow ? { workflow } : {},
    createdAt: id === 'task-2' ? '2026-07-10T00:02:00.000Z' : '2026-07-10T00:01:00.000Z',
    updatedAt: at,
  }
}

function snapshotFixture(): CanvasSnapshot {
  const operation = operationNode()
  const oldOutput = outputNode('output-old', 'asset-old', '旧方案')
  const latestA = outputNode('output-a', 'asset-a', '方案 A')
  const latestB = outputNode('output-b', 'asset-b', '方案 B')
  return {
    project: {
      id: 'project-1',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: 4,
      assetCount: 3,
      taskCount: 2,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 1,
      name: 'Board',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    nodes: [operation, oldOutput, latestA, latestB],
    edges: [
      ...[
        ['edge-old', 'output-old', 'task-1'],
        ['edge-a', 'output-a', 'task-2'],
        ['edge-b', 'output-b', 'task-2'],
      ].map(([id, targetNodeId, taskId]) => ({
        id: id!,
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        sourceNodeId: operation.id,
        targetNodeId: targetNodeId!,
        type: 'generated' as const,
        taskId: taskId ?? null,
        metadata: {},
        createdAt: at,
      })),
    ],
    assets: [asset('asset-old', '旧方案'), asset('asset-a', '方案 A'), asset('asset-b', '方案 B')],
    tasks: [
      task('task-1', ['output-old'], ['asset-old']),
      task('task-2', ['output-a', 'output-b'], ['asset-a', 'asset-b']),
    ],
  }
}

describe('canvas operation input expansion', () => {
  it('passes an upstream operation primary image to the next detail or video task', () => {
    const snapshot = snapshotFixture()
    const operation = snapshot.nodes.find((node) => node.id === 'operation-1')!
    const expanded = expandCanvasInputNodes([operation], snapshot)
    expect(expanded).toHaveLength(1)
    expect(expanded[0]).toMatchObject({ id: 'output-a', type: 'image' })
  })
})

describe('canvas operation output model', () => {
  it('treats generic multi-output media runs as candidates and defaults to the newest first output', () => {
    const snapshot = snapshotFixture()
    const node = snapshot.nodes[0]!
    const runs = buildCanvasOperationRunViews(node, snapshot)

    expect(inferCanvasOperationOutputMode(node, runs)).toBe('candidates')
    expect(resolveCanvasOperationOutputState(node, runs)).toMatchObject({
      mode: 'candidates',
      primaryRunIndex: 0,
      primaryOutputIndex: 0,
      primaryOutput: { nodeId: 'output-a' },
    })
  })

  it('keeps a manually selected historical output as the primary resource', () => {
    const snapshot = snapshotFixture()
    const node = snapshot.nodes[0]!
    node.data.primaryOutputId = 'asset-old'
    node.data.primaryOutputSelection = 'manual'
    const runs = buildCanvasOperationRunViews(node, snapshot)

    expect(resolveCanvasOperationOutputState(node, runs)).toMatchObject({
      primaryRunIndex: 1,
      primaryOutputIndex: 0,
      primaryOutput: { nodeId: 'output-old', assetId: 'asset-old' },
    })
  })

  it.each(['running', 'failed', 'cancelled'] as const)(
    'keeps the latest historical output visible when the newest run is %s without outputs',
    (status) => {
      const operation = operationNode({ status })
      operation.taskId = `task-${status}`
      const emptyTask: CanvasTask = {
        id: `task-${status}`,
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 1,
        operation: 'text_to_image',
        status,
        progress: 0,
        inputNodeIds: [],
        inputAssetIds: [],
        outputNodeIds: [],
        outputAssetIds: [],
        ...(status === 'failed' ? { errorMsg: '生成失败', errorDetail: 'detail-reason' } : {}),
        modelParams: {},
        createdAt: '2026-07-10T00:03:00.000Z',
        updatedAt: at,
      }
      const oldOutput = outputNode('output-old', 'asset-old', '旧方案')
      const base = snapshotFixture()
      const snapshot: CanvasSnapshot = {
        ...base,
        nodes: [operation, oldOutput],
        edges: [
          {
            id: 'edge-old',
            projectId: 'project-1',
            boardId: 'board-1',
            userId: 1,
            sourceNodeId: operation.id,
            targetNodeId: 'output-old',
            type: 'generated' as const,
            taskId: 'task-1',
            metadata: {},
            createdAt: at,
          },
        ],
        assets: [asset('asset-old', '旧方案')],
        tasks: [emptyTask, task('task-1', ['output-old'], ['asset-old'])],
      }

      const runs = buildCanvasOperationRunViews(operation, snapshot)
      expect(runs[0]).toMatchObject({
        taskId: `task-${status}`,
        status,
        outputs: [],
      })
      expect(resolveCanvasOperationOutputState(operation, runs)).toMatchObject({
        primaryRunIndex: 1,
        primaryOutputIndex: 0,
        primaryOutput: { nodeId: 'output-old', assetId: 'asset-old' },
      })
    },
  )

  it('passes only the primary candidate into downstream tasks', () => {
    const snapshot = snapshotFixture()
    const node = snapshot.nodes[0]!
    node.data.primaryOutputId = 'output-b'

    expect(resolveCanvasOperationInputNodes(node, snapshot).map((item) => item.id)).toEqual([
      'output-b',
    ])
  })

  it('passes the whole latest collection into downstream tasks', () => {
    const snapshot = snapshotFixture()
    const node = snapshot.nodes[0]!
    node.data.modelParams = { workflow: 'extract_character' }

    expect(inferCanvasOperationOutputMode(node, buildCanvasOperationRunViews(node, snapshot))).toBe(
      'collection',
    )
    expect(resolveCanvasOperationInputNodes(node, snapshot).map((item) => item.id)).toEqual([
      'output-a',
      'output-b',
    ])
  })

  it('materializes asset-only outputs as ephemeral input nodes without creating canvas nodes', () => {
    const snapshot = snapshotFixture()
    const node = snapshot.nodes[0]!
    node.type = 'text_generate'
    node.data.operation = 'text_generate'
    node.data.modelParams = { workflow: 'script_breakdown' }
    snapshot.nodes = [node]
    snapshot.assets = [
      asset('character-a', '角色 A', 'text'),
      asset('character-b', '角色 B', 'text'),
    ]
    snapshot.tasks = [task('task-2', [], ['character-a', 'character-b'], 'script_breakdown')]
    snapshot.edges = []

    expect(resolveCanvasOperationInputNodes(node, snapshot)).toEqual([
      expect.objectContaining({
        id: 'operation-output:character-a',
        assetId: 'character-a',
        type: 'text',
      }),
      expect.objectContaining({
        id: 'operation-output:character-b',
        assetId: 'character-b',
        type: 'text',
      }),
    ])
  })

  it('resolves the primary resource node from asset-only outputs', () => {
    const snapshot = snapshotFixture()
    const node = snapshot.nodes[0]!
    snapshot.nodes = [node]
    snapshot.assets = [asset('asset-a', '方案 A')]
    snapshot.tasks = [task('task-2', [], ['asset-a'])]
    snapshot.edges = []

    expect(resolveCanvasOperationResourceNode(node, snapshot)).toEqual(
      expect.objectContaining({
        id: 'operation-output:asset-a',
        type: 'image',
        assetId: 'asset-a',
      }),
    )
  })

  it('把资源元数据中的全景标记补回已有的图片产物节点', () => {
    const snapshot = snapshotFixture()
    const node = snapshot.nodes[0]!
    const persistedOutput = outputNode('output-a', 'asset-a', '方案 A')
    snapshot.nodes = [node, persistedOutput]
    snapshot.assets = [
      {
        ...asset('asset-a', '方案 A'),
        metadata: { panorama360: { projection: 'equirectangular' } },
      },
    ]
    snapshot.tasks = [task('task-2', ['output-a'], ['asset-a'])]
    snapshot.edges = []

    expect(resolveCanvasOperationResourceNode(node, snapshot)).toMatchObject({
      id: 'output-a',
      data: { panorama360: { projection: 'equirectangular' } },
    })
  })

  it('selects explicit outputs for expansion and deduplicates history by asset identity', () => {
    const snapshot = snapshotFixture()
    const runs = buildCanvasOperationRunViews(snapshot.nodes[0]!, snapshot)

    expect(
      selectCanvasOperationOutputs(runs, {
        scope: 'selected',
        selectedOutputIds: ['asset-b', 'output-old', 'asset-b'],
      }).map((output) => output.nodeId),
    ).toEqual(['output-b', 'output-old'])
  })

  it('collects every image asset across all runs for asset-level picking', () => {
    const snapshot = snapshotFixture()
    const node = snapshot.nodes[0]!

    // runs 按 createdAt 降序：task-2（asset-a/asset-b）在前，task-1（asset-old）在后
    expect(collectCanvasOperationImageAssets(node, snapshot).map((item) => item.id)).toEqual([
      'asset-a',
      'asset-b',
      'asset-old',
    ])
  })

  it('skips non-image outputs when collecting image assets', () => {
    const snapshot = snapshotFixture()
    const node = snapshot.nodes[0]!
    snapshot.assets = snapshot.assets.map((item) =>
      item.id === 'asset-old' ? { ...item, type: 'text' } : item,
    )

    expect(collectCanvasOperationImageAssets(node, snapshot).map((item) => item.id)).toEqual([
      'asset-a',
      'asset-b',
    ])
  })

  it('collects nothing for non-operation nodes', () => {
    const snapshot = snapshotFixture()
    const imageNode = snapshot.nodes.find((item) => item.id === 'output-a')!

    expect(collectCanvasOperationImageAssets(imageNode, snapshot)).toEqual([])
  })
})
