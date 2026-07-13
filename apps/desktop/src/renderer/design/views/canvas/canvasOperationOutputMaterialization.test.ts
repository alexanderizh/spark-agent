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
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]?.output.id).toBe('b')
    expect(plan.items[0]?.x).not.toBe(existing.x)
  })

  it('lays out large batches in a compact grid to the right of the step node', () => {
    const plan = planCanvasOperationOutputMaterialization({
      operationNode: operationNode(),
      outputs: [output('a'), output('b'), output('c'), output('d')],
      existingNodes: [],
    })

    expect(plan.items).toHaveLength(4)
    expect(plan.items[0]?.x).toBeGreaterThan(operationNode().x + operationNode().width)
    expect(plan.items[1]?.x).toBeGreaterThan(plan.items[0]?.x ?? 0)
    expect(plan.items[3]?.y).toBeGreaterThan(plan.items[0]?.y ?? 0)
  })
})
