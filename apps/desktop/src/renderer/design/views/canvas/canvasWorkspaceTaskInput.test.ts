import { describe, expect, it } from 'vitest'
import { resolveCanvasPipelineTextSource } from './canvasWorkspaceTaskInput'
import type { CanvasAsset, CanvasNode, CanvasSnapshot, CanvasTask } from './canvas.types'

const at = '2026-07-16T00:00:00.000Z'

function operationNode(): CanvasNode {
  return {
    id: 'operation-screenplay',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text_rewrite',
    taskId: 'task-screenplay',
    title: '转剧本',
    x: 0,
    y: 0,
    width: 420,
    height: 320,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {
      operation: 'text_rewrite',
      status: 'completed',
      outputPipelineRole: 'screenplay',
    },
    createdAt: at,
    updatedAt: at,
  }
}

function screenplayAsset(): CanvasAsset {
  return {
    id: 'asset-screenplay',
    projectId: 'project-1',
    userId: 1,
    type: 'text',
    source: 'ai_generated',
    title: '转剧本结果',
    contentText: '场 1：雨夜车站\n林岚走入候车厅。',
    metadata: { taskId: 'task-screenplay' },
    createdAt: at,
    updatedAt: at,
  }
}

function screenplayTask(outputNodeIds: string[]): CanvasTask {
  return {
    id: 'task-screenplay',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    operation: 'text_rewrite',
    status: 'completed',
    progress: 100,
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds,
    outputAssetIds: ['asset-screenplay'],
    modelParams: {},
    createdAt: at,
    updatedAt: at,
  }
}

function snapshotWith(nodes: CanvasNode[], task: CanvasTask): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 1,
      title: 'Project',
      status: 'active',
      nodeCount: nodes.length,
      assetCount: 1,
      taskCount: 1,
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
    nodes,
    edges: [],
    assets: [screenplayAsset()],
    tasks: [task],
  }
}

describe('resolveCanvasPipelineTextSource', () => {
  it('reads screenplay text from the completed 转剧本 operation primary output node', () => {
    const operation = operationNode()
    const output: CanvasNode = {
      ...operation,
      id: 'node-screenplay-output',
      type: 'text',
      taskId: null,
      assetId: 'asset-screenplay',
      title: '转剧本结果',
      x: 500,
      data: {
        text: '场 1：雨夜车站\n林岚走入候车厅。',
        format: 'markdown',
        origin: 'task_output',
        pipelineRole: 'screenplay',
      },
    }
    const snapshot = snapshotWith([operation, output], screenplayTask([output.id]))

    expect(resolveCanvasPipelineTextSource(operation, snapshot)).toEqual({
      sourceNode: output,
      sourceText: '场 1：雨夜车站\n林岚走入候车厅。',
    })
  })

  it('uses asset text but keeps the operation node when the output has no persisted node', () => {
    const operation = operationNode()
    const snapshot = snapshotWith([operation], screenplayTask([]))

    expect(resolveCanvasPipelineTextSource(operation, snapshot)).toEqual({
      sourceNode: operation,
      sourceText: '场 1：雨夜车站\n林岚走入候车厅。',
    })
  })
})
