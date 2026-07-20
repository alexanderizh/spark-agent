import { describe, expect, it } from 'vitest'
import {
  canvasTaskIdsSafeToDelete,
  effectiveCanvasOperationStatus,
  recoverCanvasTaskFromMaterializedOutputs,
} from './canvasTaskOutputIntegrity'
import type { CanvasAsset, CanvasEdge, CanvasNode, CanvasTask } from './canvas.types'

const at = '2026-07-20T02:41:50.000Z'

function fixtures() {
  const operationNode: CanvasNode = {
    id: 'operation-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    type: 'image_to_video',
    taskId: 'task-timeout',
    x: 0,
    y: 0,
    width: 320,
    height: 240,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {
      operation: 'image_to_video',
      status: 'failed',
      progress: 100,
      message: '失败：Task timed out after 600000ms',
    },
    createdAt: at,
    updatedAt: at,
  }
  const outputNode: CanvasNode = {
    ...operationNode,
    id: 'output-1',
    type: 'video',
    taskId: null,
    assetId: 'asset-1',
    data: { url: 'safe-file://video.mp4', origin: 'task_output' },
  }
  const task: CanvasTask = {
    id: 'task-timeout',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    operation: 'image_to_video',
    status: 'failed',
    progress: 100,
    operationNodeId: operationNode.id,
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds: [],
    outputAssetIds: [],
    modelParams: {},
    errorMsg: 'task_timeout',
    errorDetail: 'Task timed out after 600000ms',
    createdAt: at,
    updatedAt: at,
  }
  const asset: CanvasAsset = {
    id: 'asset-1',
    projectId: 'project-1',
    userId: 0,
    type: 'video',
    source: 'ai_generated',
    url: 'safe-file://video.mp4',
    metadata: {},
    createdAt: at,
    updatedAt: at,
  }
  const edge: CanvasEdge = {
    id: 'edge-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    sourceNodeId: operationNode.id,
    targetNodeId: outputNode.id,
    type: 'generated',
    taskId: task.id,
    metadata: {},
    createdAt: at,
  }
  return { operationNode, outputNode, task, asset, edge }
}

describe('canvas task output integrity', () => {
  it('recovers a failed task when a playable output is attached', () => {
    const { operationNode, outputNode, task, asset } = fixtures()

    const recovered = recoverCanvasTaskFromMaterializedOutputs({
      task,
      operationNode,
      outputNodeIds: [outputNode.id],
      outputAssetIds: [asset.id],
      at,
    })

    expect(recovered).toBe(true)
    expect(task).toMatchObject({
      status: 'completed',
      progress: 100,
      errorMsg: null,
      errorDetail: null,
      outputNodeIds: ['output-1'],
      outputAssetIds: ['asset-1'],
    })
    expect(task.runtimeEvents?.at(-1)).toMatchObject({ kind: 'completed' })
    expect(operationNode.data).toMatchObject({
      status: 'completed',
      progress: 100,
      message: '1 个产物已恢复',
    })
  })

  it('keeps materialized failed tasks while deleting failures without outputs', () => {
    const { operationNode, outputNode, task, asset, edge } = fixtures()
    const emptyTask: CanvasTask = {
      ...task,
      id: 'task-empty',
      operationNodeId: null,
      outputNodeIds: [],
      outputAssetIds: [],
    }

    const safeToDelete = canvasTaskIdsSafeToDelete({
      projectId: 'project-1',
      taskIds: [task.id, emptyTask.id],
      tasks: [task, emptyTask],
      nodes: [operationNode, outputNode],
      assets: [asset],
      edges: [edge],
      at,
    })

    expect([...safeToDelete]).toEqual(['task-empty'])
    expect(task.status).toBe('completed')
    expect(task.outputNodeIds).toEqual(['output-1'])
    expect(task.outputAssetIds).toEqual(['asset-1'])
  })

  it('presents legacy failed nodes with surviving outputs as completed', () => {
    expect(effectiveCanvasOperationStatus('failed', true)).toBe('completed')
    expect(effectiveCanvasOperationStatus('failed', false)).toBe('failed')
    expect(effectiveCanvasOperationStatus('running', true)).toBe('running')
  })
})
