import type { CanvasNode } from './canvas.types'

export type CanvasContextMenuPositionInput = {
  point: { x: number; y: number }
  container: { width: number; height: number }
  menu: { width: number; height: number }
  submenu?: { width: number }
  inset?: number
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

export function calculateCanvasContextMenuPosition({
  point,
  container,
  menu,
  submenu = { width: 260 },
  inset = 8,
}: CanvasContextMenuPositionInput): CanvasContextMenuPosition {
  const availableWidth = Math.max(0, container.width - inset * 2)
  const availableHeight = Math.max(0, container.height - inset * 2)
  const menuWidth = Math.min(menu.width, availableWidth || menu.width)
  const menuHeight = Math.min(menu.height, availableHeight || menu.height)
  const left = clamp(point.x, inset, container.width - menuWidth - inset)
  const top = clamp(point.y, inset, container.height - menuHeight - inset)

  return {
    left,
    top,
    maxHeight: availableHeight,
    openSubmenusLeft: point.x + menuWidth + submenu.width + inset > container.width,
    openSubmenusUp: point.y + menuHeight + inset > container.height,
  }
}

export function summarizeCanvasSelectionContext(
  selectedNodes: Pick<CanvasNode, 'id' | 'type' | 'parentNodeId'>[],
): CanvasSelectionContextSummary {
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
