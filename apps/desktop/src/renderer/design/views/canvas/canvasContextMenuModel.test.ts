import { describe, expect, it } from 'vitest'
import {
  calculateCanvasContextMenuPosition,
  shouldOpenCanvasSelectionContextMenu,
  summarizeCanvasSelectionContext,
} from './canvasContextMenuModel'
import type { CanvasNode } from './canvas.types'

function node(input: Partial<CanvasNode> & Pick<CanvasNode, 'id' | 'type'>): CanvasNode {
  return {
    id: input.id,
    projectId: 'project',
    boardId: 'board',
    userId: 1,
    type: input.type,
    title: input.title ?? input.id,
    parentNodeId: input.parentNodeId ?? null,
    x: input.x ?? 0,
    y: input.y ?? 0,
    width: input.width ?? 200,
    height: input.height ?? 120,
    rotation: 0,
    zIndex: input.zIndex ?? 1,
    locked: input.locked ?? false,
    hidden: false,
    data: input.data ?? {},
    createdAt: input.createdAt ?? '2026-07-10T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-07-10T00:00:00.000Z',
  }
}

describe('canvasContextMenuModel', () => {
  describe('calculateCanvasContextMenuPosition', () => {
    it('keeps the primary menu inside the viewport when opened near the bottom edge', () => {
      const result = calculateCanvasContextMenuPosition({
        point: { x: 360, y: 590 },
        container: { width: 800, height: 600 },
        menu: { width: 280, height: 520 },
      })

      expect(result.top).toBe(72)
      expect(result.maxHeight).toBe(584)
      expect(result.openSubmenusUp).toBe(true)
    })

    it('opens submenus left when there is not enough room on the right', () => {
      const result = calculateCanvasContextMenuPosition({
        point: { x: 770, y: 120 },
        container: { width: 800, height: 600 },
        menu: { width: 280, height: 420 },
        submenu: { width: 260 },
      })

      expect(result.left).toBe(512)
      expect(result.openSubmenusLeft).toBe(true)
      expect(result.openSubmenusUp).toBe(false)
    })

    it('pins an oversized menu to the viewport inset and lets the menu scroll', () => {
      const result = calculateCanvasContextMenuPosition({
        point: { x: 180, y: 64 },
        container: { width: 800, height: 600 },
        menu: { width: 280, height: 900 },
      })

      expect(result.top).toBe(8)
      expect(result.maxHeight).toBe(584)
      expect(result.top + result.maxHeight).toBe(592)
    })
  })

  describe('summarizeCanvasSelectionContext', () => {
    it('enables group creation and merge-to-image for multiple top-level content nodes', () => {
      const result = summarizeCanvasSelectionContext([
        node({ id: 'image-1', type: 'image' }),
        node({ id: 'text-1', type: 'text' }),
      ])

      expect(result.canCreateGroup).toBe(true)
      expect(result.canMergeSelectionToImage).toBe(true)
      expect(result.topLevelNodeIds).toEqual(['image-1', 'text-1'])
    })

    it('enables merging when a single group is selected', () => {
      const result = summarizeCanvasSelectionContext([node({ id: 'group-1', type: 'group' })])

      expect(result.canDissolveGroup).toBe(true)
      expect(result.canMergeSelectionToImage).toBe(true)
      expect(result.mergeGroupId).toBe('group-1')
    })

    it('does not offer group creation for grouped children', () => {
      const result = summarizeCanvasSelectionContext([
        node({ id: 'child-1', type: 'image', parentNodeId: 'group-1' }),
        node({ id: 'child-2', type: 'text', parentNodeId: 'group-1' }),
      ])

      expect(result.canCreateGroup).toBe(false)
      expect(result.canRemoveFromGroup).toBe(true)
      expect(result.canMergeSelectionToImage).toBe(false)
    })
  })

  describe('shouldOpenCanvasSelectionContextMenu', () => {
    it('opens for a selected node in a multi-node selection', () => {
      expect(
        shouldOpenCanvasSelectionContextMenu({
          selectedNodeIds: ['node-1', 'node-2'],
          targetNodeId: 'node-1',
        }),
      ).toBe(true)
    })

    it('does not replace the node menu when only one node is selected', () => {
      // 单选右键交给节点富菜单，避免选中/未选中时菜单不一致。
      expect(
        shouldOpenCanvasSelectionContextMenu({
          selectedNodeIds: ['node-1'],
          targetNodeId: 'node-1',
        }),
      ).toBe(false)
    })

    it('does not replace the node menu when nothing is selected', () => {
      expect(
        shouldOpenCanvasSelectionContextMenu({
          selectedNodeIds: [],
          targetNodeId: 'node-1',
        }),
      ).toBe(false)
    })

    it('does not replace the normal node menu for an unselected node', () => {
      expect(
        shouldOpenCanvasSelectionContextMenu({
          selectedNodeIds: ['node-1', 'node-2'],
          targetNodeId: 'node-3',
        }),
      ).toBe(false)
    })

    it('opens for selection overlay or selected-area empty space', () => {
      expect(
        shouldOpenCanvasSelectionContextMenu({
          selectedNodeIds: ['node-1', 'node-2'],
          targetNodeId: null,
        }),
      ).toBe(true)
    })

    it('does not open over editable controls', () => {
      expect(
        shouldOpenCanvasSelectionContextMenu({
          selectedNodeIds: ['node-1', 'node-2'],
          targetNodeId: null,
          isEditableTarget: true,
        }),
      ).toBe(false)
    })
  })
})
