import { describe, expect, it } from 'vitest'
import {
  planCanvasPipelineTaskPositions,
  resolveCanvasPipelineAssetTargets,
} from './canvasPipelineActionBatch'
import { OPERATION_NODE_DEFAULT_SIZE } from './canvasNodeSize'
import type { CanvasAsset, CanvasNode, CanvasSnapshot, CanvasTask } from './canvas.types'

const at = '2026-07-16T00:00:00.000Z'

function node(input: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type'>): CanvasNode {
  return {
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    title: input.id,
    x: 0,
    y: 0,
    width: 320,
    height: 220,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: at,
    updatedAt: at,
    ...input,
  }
}

function asset(id: string, kind: 'character' | 'scene'): CanvasAsset {
  return {
    id,
    projectId: 'project-1',
    userId: 1,
    type: 'text',
    source: 'manual',
    title: id,
    contentText: `${id} description`,
    metadata: { kind },
    createdAt: at,
    updatedAt: at,
  }
}

function task(id: string, outputNodeIds: string[], outputAssetIds: string[]): CanvasTask {
  return {
    id,
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    operation: 'text_generate',
    status: 'completed',
    progress: 100,
    inputNodeIds: [],
    inputAssetIds: [],
    outputNodeIds,
    outputAssetIds,
    modelParams: {},
    createdAt: at,
    updatedAt: at,
    completedAt: at,
  }
}

function snapshot(nodes: CanvasNode[], assets: CanvasAsset[], tasks: CanvasTask[]): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 1,
      title: 'Project',
      status: 'active',
      metadata: {},
      settings: {},
      nodeCount: nodes.length,
      assetCount: assets.length,
      taskCount: tasks.length,
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
    boards: [],
    assets,
    nodes,
    edges: [],
    tasks,
  }
}

describe('canvas pipeline action batch', () => {
  it('resolves every matching asset from the latest multi-output operation run', () => {
    const operation = node({
      id: 'operation-1',
      type: 'text_generate',
      taskId: 'task-1',
      data: {
        operation: 'text_generate',
        modelParams: {},
      },
    })
    const first = node({ id: 'scene-node-1', type: 'text', assetId: 'scene-1' })
    const second = node({ id: 'scene-node-2', type: 'text', assetId: 'scene-2' })
    const character = node({ id: 'character-node', type: 'text', assetId: 'character-1' })
    const current = snapshot(
      [operation, first, second, character],
      [asset('scene-1', 'scene'), asset('scene-2', 'scene'), asset('character-1', 'character')],
      [task('task-1', [first.id, second.id, character.id], ['scene-1', 'scene-2', 'character-1'])],
    )

    expect(
      resolveCanvasPipelineAssetTargets({
        sourceNode: operation,
        actionId: 'scene.scene_image',
        snapshot: current,
      }).map((target) => [target.sourceNode.id, target.asset.id]),
    ).toEqual([
      ['scene-node-1', 'scene-1'],
      ['scene-node-2', 'scene-2'],
    ])
  })

  it('plans separated task nodes and moves the whole batch away from an obstacle', () => {
    const source = node({
      id: 'source',
      type: 'text_generate',
      x: 0,
      y: 0,
      width: 320,
      height: 220,
    })
    const obstacle = node({ id: 'obstacle', type: 'text', x: 400, y: 0, width: 1200, height: 900 })
    const positions = planCanvasPipelineTaskPositions({
      sourceNode: source,
      count: 4,
      existingNodes: [source, obstacle],
    })

    expect(positions).toHaveLength(4)
    expect(
      positions.every(
        (position) =>
          position.x + OPERATION_NODE_DEFAULT_SIZE.width <= obstacle.x ||
          position.x >= obstacle.x + obstacle.width ||
          position.y + OPERATION_NODE_DEFAULT_SIZE.height <= obstacle.y ||
          position.y >= obstacle.y + obstacle.height,
      ),
    ).toBe(true)
    expect(new Set(positions.map((position) => `${position.x}:${position.y}`)).size).toBe(4)
  })
})
