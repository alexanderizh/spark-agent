import type { CSSProperties } from 'react'
import type { CanvasStageViewport } from './CanvasStage'
import { fitMediaNodeSize, fitTextNodeSize, readAssetTextForNode } from './canvas.api'
import { fitCanvasImageNodeSize } from './canvasNodeSize'
import type { CanvasAsset, CanvasNode } from './canvas.types'

export type CanvasWorkspacePoint = { x: number; y: number }
export type PreparedImageUpload = {
  file: File
  filePath: string
  width: number
  height: number
  imageWidth: number
  imageHeight: number
  title?: string
}

const GROUP_IMAGE_GAP = 18
export const GROUP_IMAGE_PADDING_X = 28
const GROUP_IMAGE_HEADER_HEIGHT = 56
export const GROUP_IMAGE_PADDING_BOTTOM = 28
export { GROUP_IMAGE_HEADER_HEIGHT }

export function fitImageNodeSize(
  width: number,
  height: number,
): { width: number; height: number } {
  return fitCanvasImageNodeSize(width, height)
}

export function getImageGridMetrics(items: { width: number; height: number }[]): {
  columns: number
  columnWidths: number[]
  rowHeights: number[]
  width: number
  height: number
} {
  const columns = getImageGridColumns(items.length)
  const rows = Math.ceil(items.length / columns)
  const columnWidths = Array.from({ length: columns }, () => 0)
  const rowHeights = Array.from({ length: rows }, () => 0)

  items.forEach((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, item.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, item.height)
  })

  return {
    columns,
    columnWidths,
    rowHeights,
    width:
      columnWidths.reduce((total, width) => total + width, 0) +
      Math.max(0, columns - 1) * GROUP_IMAGE_GAP,
    height:
      rowHeights.reduce((total, height) => total + height, 0) +
      Math.max(0, rows - 1) * GROUP_IMAGE_GAP,
  }
}

export function layoutGroupedImages<T extends { width: number; height: number }>(
  items: T[],
  groupPosition: CanvasWorkspacePoint,
): (T & CanvasWorkspacePoint)[] {
  const metrics = getImageGridMetrics(items)
  const columnOffsets = metrics.columnWidths.map(
    (_, index) =>
      metrics.columnWidths.slice(0, index).reduce((total, width) => total + width, 0) +
      index * GROUP_IMAGE_GAP,
  )
  const rowOffsets = metrics.rowHeights.map(
    (_, index) =>
      metrics.rowHeights.slice(0, index).reduce((total, height) => total + height, 0) +
      index * GROUP_IMAGE_GAP,
  )

  return items.map((item, index) => {
    const column = index % metrics.columns
    const row = Math.floor(index / metrics.columns)
    return {
      ...item,
      x: Math.round(groupPosition.x + GROUP_IMAGE_PADDING_X + (columnOffsets[column] ?? 0)),
      y: Math.round(groupPosition.y + GROUP_IMAGE_HEADER_HEIGHT + (rowOffsets[row] ?? 0)),
    }
  })
}

export function positionNodeInViewport(
  viewport: CanvasStageViewport | null,
  size: { width: number; height: number },
  fallback: { x: number; y: number },
): { x: number; y: number } {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0 || viewport.zoom <= 0) {
    return fallback
  }

  const visibleLeft = -viewport.x / viewport.zoom
  const visibleTop = -viewport.y / viewport.zoom
  const visibleRight = (viewport.width - viewport.x) / viewport.zoom
  const visibleBottom = (viewport.height - viewport.y) / viewport.zoom
  const centerX = visibleLeft + (visibleRight - visibleLeft) / 2
  const centerY = visibleTop + (visibleBottom - visibleTop) / 2

  return {
    x: Math.round(
      clampPosition(centerX - size.width / 2, visibleLeft + 24, visibleRight - size.width - 24),
    ),
    y: Math.round(
      clampPosition(centerY - size.height / 2, visibleTop + 24, visibleBottom - size.height - 24),
    ),
  }
}

export function resolveAssetInsertSize(asset: CanvasAsset): { width: number; height: number } {
  if (asset.type === 'text' || asset.type === 'prompt') {
    return fitTextNodeSize(readAssetTextForNode(asset))
  }
  return fitMediaNodeSize(asset.type, asset.width, asset.height)
}

export function getFloatingEditorGeometry(
  node: CanvasNode,
  viewport: CanvasStageViewport | null,
): { toolbar: CSSProperties; panel: CSSProperties } | null {
  const effectiveViewport: CanvasStageViewport =
    viewport && viewport.width > 0 && viewport.height > 0 && viewport.zoom > 0
      ? viewport
      : {
          x: viewport?.x ?? 0,
          y: viewport?.y ?? 0,
          zoom: viewport?.zoom && viewport.zoom > 0 ? viewport.zoom : 1,
          width: typeof window === 'undefined' ? 1024 : Math.max(640, window.innerWidth || 1024),
          height: typeof window === 'undefined' ? 720 : Math.max(480, window.innerHeight || 720),
        }

  const nodeLeft = effectiveViewport.x + node.x * effectiveViewport.zoom
  const nodeTop = effectiveViewport.y + node.y * effectiveViewport.zoom
  const nodeRight = effectiveViewport.x + (node.x + node.width) * effectiveViewport.zoom
  const nodeBottom = effectiveViewport.y + (node.y + node.height) * effectiveViewport.zoom
  const nodeCenterX = nodeLeft + (nodeRight - nodeLeft) / 2
  const floatingWidth = Math.min(920, Math.max(480, effectiveViewport.width - 96))
  const toolbarLeft = clampPosition(nodeCenterX, 180, effectiveViewport.width - 180)
  const panelLeft = clampPosition(
    nodeCenterX,
    floatingWidth / 2 + 16,
    effectiveViewport.width - floatingWidth / 2 - 16,
  )
  const toolbarTop = clampPosition(nodeTop - 68, 14, Math.max(14, effectiveViewport.height - 160))
  const panelTop = clampPosition(
    nodeBottom + 18,
    112,
    Math.max(112, effectiveViewport.height - 250),
  )

  return {
    toolbar: { left: toolbarLeft, top: toolbarTop },
    panel: {
      left: panelLeft,
      top: panelTop,
      width: floatingWidth,
    },
  }
}

export function placeNodeRightOfNodes(
  nodes: CanvasNode[],
  fallback: { x: number; y: number },
  gap = 80,
): { x: number; y: number } {
  if (nodes.length === 0) return fallback
  const right = Math.max(...nodes.map((node) => node.x + node.width))
  const top = Math.min(...nodes.map((node) => node.y))
  return {
    x: Math.round(right + gap),
    y: Math.round(top),
  }
}

function getImageGridColumns(count: number): number {
  if (count <= 1) return 1
  return Math.min(3, Math.ceil(Math.sqrt(count)))
}

function clampPosition(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}
