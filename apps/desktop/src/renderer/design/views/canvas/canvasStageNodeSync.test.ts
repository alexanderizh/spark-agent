import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { CanvasFlowNodeData } from './CanvasNode'
import { mergeFlowNodes } from './canvasStageNodeSync'
import type { CanvasNode } from './canvas.types'

function createCanvasNode(updatedAt: string): CanvasNode {
  return {
    id: 'node-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text',
    title: 'Node',
    x: 10,
    y: 20,
    width: 180,
    height: 120,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { text: 'hello' },
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt,
  }
}

function createFlowNode(
  canvasNode: CanvasNode,
  overrides: Partial<Node<CanvasFlowNodeData>> = {},
): Node<CanvasFlowNodeData> {
  return {
    id: canvasNode.id,
    type: 'sparkCanvasNode',
    position: { x: canvasNode.x, y: canvasNode.y },
    width: canvasNode.width,
    height: canvasNode.height,
    selected: false,
    data: {
      canvasNode,
      actions: {} as CanvasFlowNodeData['actions'],
    },
    ...overrides,
  }
}

describe('mergeFlowNodes', () => {
  it('preserves measured dimensions across snapshot content refreshes', () => {
    const previous = createFlowNode(createCanvasNode('2026-07-18T00:00:00.000Z'), {
      measured: { width: 180, height: 120 },
    })
    const refreshed = createFlowNode(createCanvasNode('2026-07-18T00:00:01.000Z'))

    const merged = mergeFlowNodes([previous], [refreshed])

    expect(merged[0]?.measured).toEqual({ width: 180, height: 120 })
  })

  it('drops stale measurements when the rendered size changes', () => {
    const previous = createFlowNode(createCanvasNode('2026-07-18T00:00:00.000Z'), {
      measured: { width: 180, height: 120 },
    })
    const refreshed = createFlowNode(createCanvasNode('2026-07-18T00:00:01.000Z'), {
      width: 240,
    })

    const merged = mergeFlowNodes([previous], [refreshed])

    expect(merged[0]?.measured).toBeUndefined()
  })
})
