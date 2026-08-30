import { describe, expect, it } from 'vitest'
import {
  calculateCanvasContextMenuAnchorSpace,
  calculateCanvasContextMenuPosition,
  CANVAS_CONTEXT_MENU_STAGE_INSETS,
  getCanvasTaskSubmitActionState,
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
  describe('getCanvasTaskSubmitActionState', () => {
    it('enables saved operation nodes and disables running tasks', () => {
      expect(
        getCanvasTaskSubmitActionState(
          node({ id: 'task', type: 'text_to_image', data: { status: 'pending' } }),
        ),
      ).toEqual({ visible: true, disabled: false, reason: null })
      expect(
        getCanvasTaskSubmitActionState(
          node({ id: 'running', type: 'text_to_video', data: { status: 'running' } }),
        ),
      ).toEqual({ visible: true, disabled: true, reason: '任务正在运行' })
    })

    it('does not expose submit for content nodes', () => {
      expect(
        getCanvasTaskSubmitActionState(node({ id: 'note', type: 'text' })),
      ).toEqual({ visible: false, disabled: true, reason: '所选节点不是任务节点' })
    })
  })

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

    it('reserves the bottom dock safe area for canvas and connection menus', () => {
      const result = calculateCanvasContextMenuPosition({
        point: { x: 360, y: 590 },
        container: { width: 800, height: 600 },
        menu: { width: 280, height: 900 },
        inset: CANVAS_CONTEXT_MENU_STAGE_INSETS,
      })

      expect(result.top).toBe(8)
      expect(result.maxHeight).toBe(520)
      expect(result.top + result.maxHeight).toBe(528)
      expect(result.openSubmenusUp).toBe(true)
    })

    it('chooses the roomier side and constrains a node dropdown to that space', () => {
      expect(
        calculateCanvasContextMenuAnchorSpace({
          point: { x: 760, y: 500 },
          container: { width: 800, height: 600 },
          inset: CANVAS_CONTEXT_MENU_STAGE_INSETS,
        }),
      ).toEqual({
        maxHeight: 492,
        maxWidth: 752,
        placement: 'topRight',
      })
    })
  })

  describe('summarizeCanvasSelectionContext', () => {
    it('enables task actions for mixed operation types', () => {
      const result = summarizeCanvasSelectionContext([
        node({ id: 'image-task', type: 'text_to_image' }),
        node({ id: 'video-task', type: 'text_to_video' }),
      ])

      expect(result.canBatchConfigureTasks).toBe(true)
      expect(result.canBatchSubmitTasks).toBe(true)
      expect(result.batchTaskNodeIds).toEqual(['image-task', 'video-task'])
      expect(result.batchTaskOperationCount).toBe(2)
      expect(result.batchTaskConfigureDisabledReason).toBeNull()
      expect(result.batchTaskSubmitDisabledReason).toBeNull()
    })

    it('disables task actions when operation and content nodes are mixed', () => {
      const result = summarizeCanvasSelectionContext([
        node({ id: 'image-task', type: 'text_to_image' }),
        node({ id: 'note', type: 'text' }),
      ])

      expect(result.canBatchConfigureTasks).toBe(false)
      expect(result.canBatchSubmitTasks).toBe(false)
      expect(result.batchTaskNodeIds).toEqual(['image-task'])
      expect(result.batchTaskConfigureDisabledReason).toBe('仅支持同时选择任务节点')
      expect(result.batchTaskSubmitDisabledReason).toBe('仅支持同时选择任务节点')
    })

    it('allows configuring but not submitting when a selected task is running', () => {
      const result = summarizeCanvasSelectionContext([
        node({
          id: 'running-task',
          type: 'text_to_image',
          data: { status: 'running' },
        }),
        node({
          id: 'pending-task',
          type: 'text_to_video',
          data: { status: 'pending' },
        }),
      ])

      expect(result.canBatchConfigureTasks).toBe(true)
      expect(result.canBatchSubmitTasks).toBe(false)
      expect(result.batchTaskConfigureDisabledReason).toBeNull()
      expect(result.batchTaskSubmitDisabledReason).toBe('选中任务包含正在运行的节点')
    })

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
