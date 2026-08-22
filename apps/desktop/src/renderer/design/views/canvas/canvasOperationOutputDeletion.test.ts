import { describe, expect, it } from 'vitest'
import {
  applyCanvasOperationOutputDeletion,
  planCanvasOperationOutputDeletion,
} from './canvasOperationOutputDeletion'
import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasEdge, CanvasNode, CanvasTask } from './canvas.types'

const at = '2026-07-16T00:00:00.000Z'

function output(
  id: string,
  options: { taskId?: string; nodeId?: string; assetId?: string } = {},
): CanvasOperationOutputView {
  return {
    id,
    ...options,
    type: 'image',
    title: id,
    createdAt: at,
    updatedAt: at,
  }
}

function node(id: string, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'image',
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

function operationNode(taskId: string | null = 'task-2'): CanvasNode {
  return node('operation-1', {
    type: 'text_to_image',
    taskId,
    data: { primaryOutputId: 'asset-b', primaryOutputSelection: 'manual' },
  })
}

function task(id: string, outputNodeIds: string[], outputAssetIds: string[]): CanvasTask {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    operation: 'text_to_image',
    status: 'completed',
    progress: 100,
    operationNodeId: 'operation-1',
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds,
    outputAssetIds,
    modelParams: {},
    createdAt: id === 'task-2' ? '2026-07-16T00:02:00.000Z' : at,
    updatedAt: at,
  }
}

function edge(
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  type: CanvasEdge['type'] = 'generated',
  taskId: string | null = 'task-2',
): CanvasEdge {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    sourceNodeId,
    targetNodeId,
    type,
    taskId,
    metadata: {},
    createdAt: at,
  }
}

describe('planCanvasOperationOutputDeletion', () => {
  it('deletes only generated outputs owned by the requested operation and task', () => {
    expect(
      planCanvasOperationOutputDeletion({
        operationNodeId: 'operation-1',
        outputs: [
          output('node-a', { taskId: 'task-2', nodeId: 'node-a', assetId: 'asset-a' }),
          output('node-b', { taskId: 'task-other', nodeId: 'node-b', assetId: 'asset-b' }),
        ],
        nodes: [operationNode(), node('node-a'), node('node-b')],
        edges: [
          edge('edge-a', 'operation-1', 'node-a'),
          edge('edge-b', 'operation-2', 'node-b', 'generated', 'task-other'),
        ],
        tasks: [task('task-2', ['node-a'], ['asset-a'])],
      }),
    ).toMatchObject({
      edgeIds: ['edge-a'],
      nodeIds: ['node-a'],
      taskOutputRemovals: [{ taskId: 'task-2', nodeIds: ['node-a'], assetIds: ['asset-a'] }],
      deletedOutputIds: ['node-a'],
      skippedOutputIds: ['node-b'],
    })
  })

  it('plans asset-only task output deletion without requiring a canvas node', () => {
    const plan = planCanvasOperationOutputDeletion({
      operationNodeId: 'operation-1',
      outputs: [output('asset-b', { taskId: 'task-2', assetId: 'asset-b' })],
      nodes: [operationNode()],
      edges: [],
      tasks: [task('task-2', [], ['asset-a', 'asset-b'])],
    })

    expect(plan).toMatchObject({
      edgeIds: [],
      nodeIds: [],
      taskOutputRemovals: [{ taskId: 'task-2', nodeIds: [], assetIds: ['asset-b'] }],
      deletedOutputIds: ['asset-b'],
      skippedOutputIds: [],
      primaryOutputDeleted: true,
    })
  })
})

describe('applyCanvasOperationOutputDeletion', () => {
  it('removes one asset-only output while preserving the task and sibling output', () => {
    const applied = applyCanvasOperationOutputDeletion({
      projectId: 'project-1',
      operationNodeId: 'operation-1',
      outputs: [output('asset-b', { taskId: 'task-2', assetId: 'asset-b' })],
      nodes: [operationNode()],
      edges: [],
      tasks: [task('task-2', [], ['asset-a', 'asset-b'])],
      updatedAt: '2026-07-16T00:03:00.000Z',
    })

    expect(applied.tasks).toHaveLength(1)
    expect(applied.tasks[0]?.outputAssetIds).toEqual(['asset-a'])
    expect(applied.nodes[0]?.data.primaryOutputId).toBeUndefined()
    expect(applied.nodes[0]?.data.primaryOutputSelection).toBe('auto_latest')
    expect(applied.result).toEqual({
      deletedOutputCount: 1,
      deletedNodeCount: 0,
      deletedTaskCount: 0,
      skippedOutputCount: 0,
    })
  })

  it('deletes an empty latest run and points the operation node at the previous task', () => {
    const applied = applyCanvasOperationOutputDeletion({
      projectId: 'project-1',
      operationNodeId: 'operation-1',
      outputs: [output('asset-b', { taskId: 'task-2', assetId: 'asset-b' })],
      nodes: [operationNode()],
      edges: [],
      tasks: [task('task-1', [], ['asset-a']), task('task-2', [], ['asset-b'])],
      updatedAt: '2026-07-16T00:03:00.000Z',
    })

    expect(applied.tasks.map((item) => item.id)).toEqual(['task-1'])
    expect(applied.nodes[0]?.taskId).toBe('task-1')
    expect(applied.result.deletedTaskCount).toBe(1)
  })

  it('falls back to a legacy task still owned through a generated edge', () => {
    const previousTask = task('task-1', ['node-a'], ['asset-a'])
    delete previousTask.operationNodeId
    const applied = applyCanvasOperationOutputDeletion({
      projectId: 'project-1',
      operationNodeId: 'operation-1',
      outputs: [output('asset-b', { taskId: 'task-2', assetId: 'asset-b' })],
      nodes: [operationNode(), node('node-a', { assetId: 'asset-a' })],
      edges: [edge('edge-a', 'operation-1', 'node-a', 'generated', 'task-1')],
      tasks: [previousTask, task('task-2', [], ['asset-b'])],
      updatedAt: '2026-07-16T00:03:00.000Z',
    })

    expect(applied.tasks.map((item) => item.id)).toEqual(['task-1'])
    expect(applied.nodes.find((item) => item.id === 'operation-1')?.taskId).toBe('task-1')
  })

  it('cleans generated and materialized nodes but never removes another task shared asset', () => {
    const materialized = node('materialized-b', {
      assetId: 'asset-b',
      data: {
        materializedOutput: {
          operationNodeId: 'operation-1',
          outputId: 'asset-b',
          taskId: 'task-2',
          materializedAt: at,
        },
      },
    })
    const applied = applyCanvasOperationOutputDeletion({
      projectId: 'project-1',
      operationNodeId: 'operation-1',
      outputs: [
        output('asset-b', {
          taskId: 'task-2',
          nodeId: 'generated-b',
          assetId: 'asset-b',
        }),
      ],
      nodes: [operationNode(), node('generated-b', { assetId: 'asset-b' }), materialized],
      edges: [
        edge('generated-b-edge', 'operation-1', 'generated-b'),
        edge('materialized-b-edge', 'operation-1', 'materialized-b', 'references', null),
      ],
      tasks: [
        task('task-2', ['generated-b'], ['asset-b']),
        { ...task('shared-task', [], ['asset-b']), operationNodeId: 'operation-other' },
      ],
      updatedAt: '2026-07-16T00:03:00.000Z',
    })

    expect(applied.nodes.filter((item) => item.hidden).map((item) => item.id)).toEqual([
      'generated-b',
      'materialized-b',
    ])
    expect(applied.edges).toEqual([])
    expect(applied.tasks).toHaveLength(1)
    expect(applied.tasks[0]).toMatchObject({ id: 'shared-task', outputAssetIds: ['asset-b'] })
  })

  it('keeps a legacy materialized node and primary selection while another run retains the asset', () => {
    const materialized = node('materialized-b', {
      assetId: 'asset-b',
      data: {
        materializedOutput: {
          operationNodeId: 'operation-1',
          outputId: 'asset-b',
          materializedAt: at,
        },
      },
    })
    const applied = applyCanvasOperationOutputDeletion({
      projectId: 'project-1',
      operationNodeId: 'operation-1',
      outputs: [output('asset-b', { taskId: 'task-2', assetId: 'asset-b' })],
      nodes: [operationNode(), materialized],
      edges: [edge('materialized-b-edge', 'operation-1', 'materialized-b', 'references', null)],
      tasks: [task('task-1', [], ['asset-b']), task('task-2', [], ['asset-b'])],
      updatedAt: '2026-07-16T00:03:00.000Z',
    })

    expect(applied.nodes.find((item) => item.id === 'materialized-b')?.hidden).toBe(false)
    expect(applied.nodes.find((item) => item.id === 'operation-1')?.data.primaryOutputId).toBe(
      'asset-b',
    )
    expect(applied.edges.map((item) => item.id)).toEqual(['materialized-b-edge'])
    expect(applied.tasks).toHaveLength(1)
    expect(applied.tasks[0]).toMatchObject({ id: 'task-1', outputAssetIds: ['asset-b'] })
  })

  it('keeps the primary asset selection when a recovered generated run still exposes it', () => {
    const applied = applyCanvasOperationOutputDeletion({
      projectId: 'project-1',
      operationNodeId: 'operation-1',
      outputs: [output('asset-b', { taskId: 'task-2', assetId: 'asset-b' })],
      nodes: [operationNode(), node('legacy-node', { assetId: 'asset-b' })],
      edges: [edge('legacy-edge', 'operation-1', 'legacy-node', 'generated', 'legacy-task')],
      tasks: [task('task-2', [], ['asset-b'])],
      updatedAt: '2026-07-16T00:03:00.000Z',
    })

    expect(applied.nodes.find((item) => item.id === 'legacy-node')?.hidden).toBe(false)
    expect(applied.nodes.find((item) => item.id === 'operation-1')?.data.primaryOutputId).toBe(
      'asset-b',
    )
    expect(applied.edges.map((item) => item.id)).toEqual(['legacy-edge'])
  })
})
