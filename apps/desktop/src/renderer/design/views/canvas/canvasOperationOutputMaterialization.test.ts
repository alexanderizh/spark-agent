import { describe, expect, it } from 'vitest'
import { planCanvasOperationOutputMaterialization } from './canvasOperationOutputMaterialization'
import {
  AUTO_NODE_META_BAR_CLEARANCE,
  AUTO_NODE_RIGHT_GAP,
  AUTO_NODE_VERTICAL_GAP,
} from './canvasAutoPlacement'
import { IMAGE_NODE_DEFAULT_SIZE } from './canvasNodeSize'
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

  it('recognizes legacy expanded references by asset identity after a rerun', () => {
    const operation = operationNode()
    const legacyExpanded: CanvasNode = {
      ...operation,
      id: 'legacy-reference-a',
      type: 'image',
      assetId: 'asset-a',
      data: {
        materializedOutput: {
          operationNodeId: operation.id,
          outputId: 'legacy-reference-a',
          materializedAt: at,
        },
      },
    }
    const plan = planCanvasOperationOutputMaterialization({
      operationNode: operation,
      outputs: [output('a'), output('b'), output('c')],
      existingNodes: [operation, legacyExpanded],
    })

    expect(plan.existingNodeIds).toEqual(['legacy-reference-a'])
    expect(plan.items.map((item) => item.output.id)).toEqual(['b', 'c'])
  })

  it('stacks expanded outputs in a single column to the right, centered on the operation node', () => {
    const operation = operationNode()
    const plan = planCanvasOperationOutputMaterialization({
      operationNode: operation,
      outputs: [output('a'), output('b'), output('c'), output('d')],
      existingNodes: [],
    })

    expect(plan.items).toHaveLength(4)
    // 单列：所有产物 x 一致，位于原节点右侧固定间距处。
    const expectedX = operation.x + operation.width + AUTO_NODE_RIGHT_GAP
    for (const item of plan.items) {
      expect(item.x).toBe(expectedX)
    }
    // 行距固定：默认图片节点高度 + 纵向间距。
    const rowStep =
      IMAGE_NODE_DEFAULT_SIZE.height + AUTO_NODE_VERTICAL_GAP + AUTO_NODE_META_BAR_CLEARANCE
    expect(plan.items[1]!.y - plan.items[0]!.y).toBe(rowStep)
    expect(plan.items[2]!.y - plan.items[1]!.y).toBe(rowStep)
    expect(plan.items[3]!.y - plan.items[2]!.y).toBe(rowStep)
    // 列的垂直中点与原节点中心对齐。
    const first = plan.items[0]!
    const last = plan.items[3]!
    expect((first.y + (last.y + IMAGE_NODE_DEFAULT_SIZE.height)) / 2).toBe(
      operation.y + operation.height / 2,
    )
  })

  it('keeps the deterministic column placement even when nodes block the target area', () => {
    const operation = operationNode()
    const blocker: CanvasNode = {
      ...operation,
      id: 'blocker',
      type: 'text',
      x: operation.x + operation.width,
      y: -600,
      width: 800,
      height: 2000,
    }
    const plan = planCanvasOperationOutputMaterialization({
      operationNode: operation,
      outputs: [output('a'), output('b')],
      existingNodes: [operation, blocker],
    })

    expect(plan.items).toHaveLength(2)
    const expectedX = operation.x + operation.width + AUTO_NODE_RIGHT_GAP
    expect(plan.items[0]?.x).toBe(expectedX)
    expect(plan.items[1]?.x).toBe(expectedX)
    expect(plan.items[0]?.y).toBeLessThan(operation.y)
    expect(plan.items[1]?.y).toBeGreaterThan(operation.y)
  })
})
