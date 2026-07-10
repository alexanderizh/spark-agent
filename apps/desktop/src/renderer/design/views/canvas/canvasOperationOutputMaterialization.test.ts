import { describe, expect, it } from 'vitest'
import { planCanvasOperationOutputMaterialization } from './canvasOperationOutputMaterialization'
import type { CanvasNode } from './canvas.types'
import type { CanvasOperationOutputView } from './canvasOperationRuns'

const at = '2026-07-10T00:00:00.000Z'

function operationNode(): CanvasNode {
  return {
    id: 'operation-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text_to_image',
    x: 100,
    y: 200,
    width: 320,
    height: 260,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: {},
    createdAt: at,
    updatedAt: at,
  }
}

function output(id: string): CanvasOperationOutputView {
  return {
    id,
    assetId: `asset-${id}`,
    type: 'image',
    title: id,
    createdAt: at,
    updatedAt: at,
  }
}

describe('canvas operation output materialization', () => {
  it('reuses already expanded references and only plans missing outputs', () => {
    const operation = operationNode()
    const existing: CanvasNode = {
      ...operation,
      id: 'reference-a',
      type: 'image',
      assetId: 'asset-a',
      data: {
        materializedOutput: {
          operationNodeId: operation.id,
          outputId: 'a',
          materializedAt: at,
        },
      },
    }
    const plan = planCanvasOperationOutputMaterialization({
      operationNode: operation,
      outputs: [output('a'), output('b')],
      existingNodes: [operation, existing],
    })

    expect(plan.existingNodeIds).toEqual(['reference-a'])
    expect(plan.items).toEqual([
      expect.objectContaining({ output: expect.objectContaining({ id: 'b' }), x: 480, y: 200 }),
    ])
  })

  it('lays out large batches in a compact grid to the right of the step node', () => {
    const plan = planCanvasOperationOutputMaterialization({
      operationNode: operationNode(),
      outputs: [output('a'), output('b'), output('c'), output('d')],
      existingNodes: [],
    })

    expect(plan.items.map(({ x, y }) => [x, y])).toEqual([
      [480, 200],
      [840, 200],
      [1200, 200],
      [480, 500],
    ])
  })
})
