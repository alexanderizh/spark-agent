import { describe, expect, it } from 'vitest'
import { planCanvasOperationOutputDeletion } from './canvasOperationOutputDeletion'
import type { CanvasOperationOutputView } from './canvasOperationRuns'
import type { CanvasEdge } from './canvas.types'

const at = '2026-07-16T00:00:00.000Z'

function output(id: string, nodeId?: string): CanvasOperationOutputView {
  return {
    id,
    ...(nodeId ? { nodeId } : {}),
    type: 'text',
    title: id,
    text: id,
    createdAt: at,
    updatedAt: at,
  }
}

function edge(id: string, sourceNodeId: string, targetNodeId: string): CanvasEdge {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    sourceNodeId,
    targetNodeId,
    type: 'generated',
    taskId: 'task-1',
    metadata: {},
    createdAt: at,
  }
}

describe('planCanvasOperationOutputDeletion', () => {
  it('deletes only generated outputs owned by the requested operation node', () => {
    expect(
      planCanvasOperationOutputDeletion({
        operationNodeId: 'operation-1',
        outputs: [output('output-a', 'node-a'), output('output-b', 'node-b')],
        edges: [edge('edge-a', 'operation-1', 'node-a'), edge('edge-b', 'operation-2', 'node-b')],
      }),
    ).toEqual({
      edgeIds: ['edge-a'],
      nodeIds: ['node-a'],
      skippedOutputIds: ['output-b'],
    })
  })

  it('reports asset-only outputs as skipped instead of deleting unrelated data', () => {
    expect(
      planCanvasOperationOutputDeletion({
        operationNodeId: 'operation-1',
        outputs: [output('asset-only')],
        edges: [],
      }),
    ).toEqual({ edgeIds: [], nodeIds: [], skippedOutputIds: ['asset-only'] })
  })
})
