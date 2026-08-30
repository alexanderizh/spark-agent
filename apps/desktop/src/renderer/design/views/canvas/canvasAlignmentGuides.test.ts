import type { Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { CanvasFlowNodeData } from './CanvasNode'
import { computeCanvasAlignmentGuides } from './canvasAlignmentGuides'
import type { CanvasNode } from './canvas.types'

function createCanvasNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 1,
    type: 'text',
    title: 'Node',
    x: 0,
    y: 0,
    width: 100,
    height: 80,
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
  id: string,
  position: { x: number; y: number },
  size: { width: number; height: number },
  overrides: Partial<Node<CanvasFlowNodeData>> = {},
): Node<CanvasFlowNodeData> {
  const canvasNode = createCanvasNode({
    id,
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
  })

  return {
    id,
    type: 'sparkCanvasNode',
    position,
    width: size.width,
    height: size.height,
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

describe('computeCanvasAlignmentGuides', () => {
  it('returns no guides without other nodes', () => {
    const dragged = createFlowNode('dragged', { x: 10, y: 20 }, { width: 100, height: 80 })

    expect(computeCanvasAlignmentGuides([dragged], [dragged])).toEqual([])
  })

  it('finds vertical edge alignment within the threshold', () => {
    const dragged = createFlowNode('dragged', { x: 104, y: 20 }, { width: 80, height: 80 })
    const target = createFlowNode('target', { x: 100, y: 160 }, { width: 120, height: 90 })

    const guides = computeCanvasAlignmentGuides([dragged, target], [dragged])

    expect(guides).toContainEqual(
      expect.objectContaining({
        orientation: 'vertical',
        kind: 'edge',
        position: 100,
      }),
    )
    expect(guides[0]?.start).toBeLessThan(dragged.position.y)
    expect(guides[0]?.end).toBeGreaterThan(target.position.y + 90)
  })

  it('prioritizes vertical center alignment', () => {
    const dragged = createFlowNode('dragged', { x: 151, y: 20 }, { width: 98, height: 80 })
    const target = createFlowNode('target', { x: 100, y: 160 }, { width: 200, height: 90 })

    const guides = computeCanvasAlignmentGuides([dragged, target], [dragged])

    expect(guides[0]).toMatchObject({
      orientation: 'vertical',
      kind: 'center',
      position: 200,
    })
  })

  it('finds horizontal alignment guides', () => {
    const dragged = createFlowNode('dragged', { x: 40, y: 200 }, { width: 100, height: 80 })
    const target = createFlowNode('target', { x: 180, y: 100 }, { width: 120, height: 180 })

    const guides = computeCanvasAlignmentGuides([dragged, target], [dragged])

    expect(guides).toContainEqual(
      expect.objectContaining({
        orientation: 'horizontal',
        kind: 'edge',
        position: 280,
      }),
    )
  })

  it('ignores alignments outside the threshold', () => {
    const dragged = createFlowNode('dragged', { x: 107, y: 20 }, { width: 80, height: 80 })
    const target = createFlowNode('target', { x: 100, y: 160 }, { width: 120, height: 90 })

    expect(computeCanvasAlignmentGuides([dragged, target], [dragged], 6)).toEqual([])
  })

  it('dedupes guides on the same rounded position and extends the span', () => {
    const dragged = createFlowNode('dragged', { x: 100, y: 120 }, { width: 100, height: 80 })
    const targetA = createFlowNode('target-a', { x: 100, y: 20 }, { width: 80, height: 60 })
    const targetB = createFlowNode('target-b', { x: 100.4, y: 320 }, { width: 120, height: 80 })

    const guides = computeCanvasAlignmentGuides([dragged, targetA, targetB], [dragged])
    const verticalGuides = guides.filter((guide) => guide.orientation === 'vertical')

    expect(verticalGuides).toHaveLength(1)
    expect(verticalGuides[0]).toMatchObject({
      kind: 'edge',
      position: 100,
    })
    expect(verticalGuides[0]?.start).toBeLessThan(targetA.position.y)
    expect(verticalGuides[0]?.end).toBeGreaterThan(targetB.position.y + 80)
  })
})
