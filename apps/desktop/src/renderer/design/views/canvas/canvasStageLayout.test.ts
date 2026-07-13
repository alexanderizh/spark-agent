import type { Node, NodeChange } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { CanvasFlowNodeData } from './CanvasNode'
import { persistCanvasNodeLayoutChanges } from './canvasStageLayout'
import type { CanvasNode } from './canvas.types'

function createCanvasNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
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
    createdAt: '2026-06-13T00:00:00.000Z',
    updatedAt: '2026-06-13T00:00:00.000Z',
    ...overrides,
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
    data: {
      canvasNode,
      actions: {
        duplicateNode: () => undefined,
        editNode: () => undefined,
        deleteNode: () => undefined,
        downloadMedia: () => undefined,
        toggleLockNode: () => undefined,
        bringNodeToFront: () => undefined,
        mergeGroupToImage: () => undefined,
        mergeSelectionToImage: () => undefined,
        createGroupFromSelection: () => undefined,
        addSelectionToGroup: () => undefined,
        removeNodeFromGroup: () => undefined,
        dissolveGroup: () => undefined,
        openAiComposer: () => undefined,
        saveToLibrary: () => undefined,
        previewPanorama: () => undefined,
        createOperationChild: () => undefined,
        pipelineAction: () => undefined,
        setProductionState: () => undefined,
      },
    },
    ...overrides,
  }
}

describe('persistCanvasNodeLayoutChanges', () => {
  it('ignores non-layout ReactFlow changes', () => {
    const node = createCanvasNode()
    const changes = [{ id: node.id, type: 'select', selected: true }] as NodeChange<
      Node<CanvasFlowNodeData>
    >[]

    expect(persistCanvasNodeLayoutChanges([node], [createFlowNode(node)], changes)).toBeNull()
  })

  it('skips in-flight position changes while dragging', () => {
    const node = createCanvasNode()
    const changes = [
      { id: node.id, type: 'position', position: { x: 48, y: 72 }, dragging: true },
    ] as NodeChange<Node<CanvasFlowNodeData>>[]

    const nextNodes = persistCanvasNodeLayoutChanges([node], [createFlowNode(node)], changes)

    expect(nextNodes).toBeNull()
  })

  it('returns moved nodes when dragging ends', () => {
    const node = createCanvasNode()
    const changes = [
      { id: node.id, type: 'position', position: { x: 48, y: 72 }, dragging: false },
    ] as NodeChange<Node<CanvasFlowNodeData>>[]

    const nextNodes = persistCanvasNodeLayoutChanges(
      [node],
      [createFlowNode(node, { position: { x: 48, y: 72 } })],
      changes,
    )

    expect(nextNodes?.[0]?.x).toBe(48)
    expect(nextNodes?.[0]?.y).toBe(72)
  })

  it('skips position changes that do not alter persisted coordinates', () => {
    const node = createCanvasNode()
    const changes = [
      { id: node.id, type: 'position', position: { x: node.x, y: node.y }, dragging: false },
    ] as NodeChange<Node<CanvasFlowNodeData>>[]

    expect(persistCanvasNodeLayoutChanges([node], [createFlowNode(node)], changes)).toBeNull()
  })

  it('skips in-flight dimension changes while resizing', () => {
    const node = createCanvasNode()
    const changes = [
      {
        id: node.id,
        type: 'dimensions',
        dimensions: { width: 240, height: 180 },
        resizing: true,
      },
    ] as NodeChange<Node<CanvasFlowNodeData>>[]

    const nextNodes = persistCanvasNodeLayoutChanges([node], [createFlowNode(node)], changes)

    expect(nextNodes).toBeNull()
  })

  it('returns resized nodes when resizing ends', () => {
    const node = createCanvasNode()
    const changes = [
      {
        id: node.id,
        type: 'dimensions',
        dimensions: { width: 240, height: 180 },
        resizing: false,
      },
    ] as NodeChange<Node<CanvasFlowNodeData>>[]

    const nextNodes = persistCanvasNodeLayoutChanges(
      [node],
      [createFlowNode(node, { measured: { width: 240, height: 180 } })],
      changes,
    )

    expect(nextNodes?.[0]?.width).toBe(240)
    expect(nextNodes?.[0]?.height).toBe(180)
  })

  it('subtracts V4 card chrome when persisting a resized node', () => {
    const node = createCanvasNode()
    const baseFlowNode = createFlowNode(node)
    const changes = [
      {
        id: node.id,
        type: 'dimensions',
        dimensions: { width: 240, height: 267 },
        resizing: false,
      },
    ] as NodeChange<Node<CanvasFlowNodeData>>[]

    const nextNodes = persistCanvasNodeLayoutChanges(
      [node],
      [
        createFlowNode(node, {
          measured: { width: 240, height: 267 },
          data: { ...baseFlowNode.data, cardChromeExtraHeight: 87 },
        }),
      ],
      changes,
    )

    expect(nextNodes?.[0]?.width).toBe(240)
    expect(nextNodes?.[0]?.height).toBe(180)
  })
})
