import type { CanvasNode } from './canvas.types'
import { summarizeBatchTaskSelection } from './canvasBatchTaskModel'
import { isOperationNode } from './canvas.capabilities'

export type CanvasContextMenuPositionInput = {
  point: { x: number; y: number }
  container: { width: number; height: number }
  menu: { width: number; height: number }
  submenu?: { width: number }
  inset?: number | Partial<CanvasContextMenuInsets>
}

export type CanvasContextMenuInsets = {
  top: number
  right: number
  bottom: number
  left: number
}

export type CanvasContextMenuAnchorSpace = {
  maxHeight: number
  maxWidth: number
  placement: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
}

/**
 * 画布底部悬浮 dock 会遮挡内容，因此菜单的安全区不能只按浏览器视口计算。
 * 这里给所有画布右键/连线菜单共享，保证菜单在 dock 上方结束。
 */
export const CANVAS_CONTEXT_MENU_STAGE_INSETS: CanvasContextMenuInsets = {
  top: 8,
  right: 8,
  bottom: 72,
  left: 8,
}

export type CanvasContextMenuPosition = {
  left: number
  top: number
  maxHeight: number
  openSubmenusLeft: boolean
  openSubmenusUp: boolean
}

export type CanvasSelectionContextSummary = {
  selectedCount: number
  selectedGroupIds: string[]
  topLevelNodeIds: string[]
  groupedNodeIds: string[]
  canCreateGroup: boolean
  canAddToGroup: boolean
  canRemoveFromGroup: boolean
  canDissolveGroup: boolean
  canMergeSelectionToImage: boolean
  mergeGroupId: string | null
  canBatchConfigureTasks: boolean
  canBatchSubmitTasks: boolean
  batchTaskConfigureDisabledReason: string | null
  batchTaskSubmitDisabledReason: string | null
  batchTaskNodeIds: string[]
  batchTaskOperationCount: number
}

export type CanvasSelectionContextMenuTarget = {
  selectedNodeIds: readonly string[]
  targetNodeId?: string | null
  isEditableTarget?: boolean
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function resolveInsets(
  inset: number | Partial<CanvasContextMenuInsets> | undefined,
): CanvasContextMenuInsets {
  if (typeof inset === 'number') {
    return { top: inset, right: inset, bottom: inset, left: inset }
  }
  return {
    top: inset?.top ?? 8,
    right: inset?.right ?? 8,
    bottom: inset?.bottom ?? 8,
    left: inset?.left ?? 8,
  }
}

export function calculateCanvasContextMenuAnchorSpace({
  point,
  container,
  inset,
}: Pick<CanvasContextMenuPositionInput, 'point' | 'container' | 'inset'>): CanvasContextMenuAnchorSpace {
  const insets = resolveInsets(inset)
  const spaceAbove = Math.max(0, point.y - insets.top)
  const spaceBelow = Math.max(0, container.height - insets.bottom - point.y)
  const spaceLeft = Math.max(0, point.x - insets.left)
  const spaceRight = Math.max(0, container.width - insets.right - point.x)

  const openUp = spaceAbove > spaceBelow
  const alignRight = spaceLeft > spaceRight

  return {
    maxHeight: Math.max(spaceAbove, spaceBelow),
    maxWidth: Math.max(spaceLeft, spaceRight),
    placement: `${openUp ? 'top' : 'bottom'}${alignRight ? 'Right' : 'Left'}` as CanvasContextMenuAnchorSpace['placement'],
  }
}

export function getCanvasTaskSubmitActionState(
  node: Pick<CanvasNode, 'type' | 'data'>,
): { visible: boolean; disabled: boolean; reason: string | null } {
  if (!isOperationNode(node)) {
    return {
      visible: false,
      disabled: true,
      reason: '所选节点不是任务节点',
    }
  }
  if (node.data.status === 'running') {
    return {
      visible: true,
      disabled: true,
      reason: '任务正在运行',
    }
  }
  return { visible: true, disabled: false, reason: null }
}

export function calculateCanvasContextMenuPosition({
  point,
  container,
  menu,
  submenu = { width: 260 },
  inset = 8,
}: CanvasContextMenuPositionInput): CanvasContextMenuPosition {
  const insets = resolveInsets(inset)
  const availableWidth = Math.max(0, container.width - insets.left - insets.right)
  const availableHeight = Math.max(0, container.height - insets.top - insets.bottom)
  const menuWidth = Math.min(menu.width, availableWidth)
  const menuHeight = Math.min(menu.height, availableHeight)
  const left = clamp(point.x, insets.left, container.width - menuWidth - insets.right)
  const top = clamp(point.y, insets.top, container.height - menuHeight - insets.bottom)

  return {
    left,
    top,
    maxHeight: availableHeight,
    openSubmenusLeft:
      point.x + menuWidth + submenu.width + insets.right > container.width,
    openSubmenusUp: point.y + menuHeight + insets.bottom > container.height,
  }
}

export function summarizeCanvasSelectionContext(
  selectedNodes: Pick<CanvasNode, 'id' | 'type' | 'parentNodeId' | 'data'>[],
): CanvasSelectionContextSummary {
  const batchTasks = summarizeBatchTaskSelection(selectedNodes)
  const selectedGroupIds = selectedNodes.filter((node) => node.type === 'group').map((node) => node.id)
  const topLevelNodeIds = selectedNodes
    .filter((node) => node.type !== 'group' && !node.parentNodeId)
    .map((node) => node.id)
  const groupedNodeIds = selectedNodes.filter((node) => Boolean(node.parentNodeId)).map((node) => node.id)
  const canCreateGroup =
    selectedNodes.length >= 2 &&
    selectedNodes.every((node) => node.type !== 'group' && !node.parentNodeId)
  const canAddToGroup = selectedGroupIds.length === 1 && topLevelNodeIds.length > 0
  const canDissolveGroup = selectedGroupIds.length === 1
  const mergeGroupId =
    selectedGroupIds.length === 1 && selectedNodes.length === 1 ? (selectedGroupIds[0] ?? null) : null

  return {
    selectedCount: selectedNodes.length,
    selectedGroupIds,
    topLevelNodeIds,
    groupedNodeIds,
    canCreateGroup,
    canAddToGroup,
    canRemoveFromGroup: groupedNodeIds.length > 0,
    canDissolveGroup,
    canMergeSelectionToImage: Boolean(mergeGroupId) || canCreateGroup,
    mergeGroupId,
    canBatchConfigureTasks: batchTasks.canBatchConfigure,
    canBatchSubmitTasks: batchTasks.canBatchSubmit,
    batchTaskConfigureDisabledReason: batchTasks.configureReason,
    batchTaskSubmitDisabledReason: batchTasks.submitReason,
    batchTaskNodeIds: batchTasks.taskNodeIds,
    batchTaskOperationCount: batchTasks.operationCount,
  }
}

export function shouldOpenCanvasSelectionContextMenu({
  selectedNodeIds,
  targetNodeId,
  isEditableTarget = false,
}: CanvasSelectionContextMenuTarget): boolean {
  // 单选(≤1)右键交给节点 Dropdown（节点富菜单）；只有多选(≥2)才走批量面板菜单。
  // 这样同一个节点选中/未选中时右键菜单保持一致，避免菜单分叉。
  if (isEditableTarget || selectedNodeIds.length < 2) return false
  if (!targetNodeId) return true
  // 右键点中的节点在当前选区内即弹批量菜单。
  return selectedNodeIds.includes(targetNodeId)
}
