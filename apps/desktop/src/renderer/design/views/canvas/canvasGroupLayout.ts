export const GROUP_LAYOUT_PADDING_X = 28
export const GROUP_LAYOUT_PADDING_BOTTOM = 28
export const GROUP_LAYOUT_HEADER_HEIGHT = 56
export const GROUP_LAYOUT_GAP_X = 24
export const GROUP_LAYOUT_GAP_Y = 24

export type GroupLayoutItem = {
  id: string
  width: number
  height: number
  absoluteX: number
  absoluteY: number
}

export type PlannedGroupLayout = {
  x: number
  y: number
  width: number
  height: number
  members: Array<{ id: string; x: number; y: number }>
}

function columnCountFor(itemCount: number): number {
  if (itemCount <= 1) return 1
  if (itemCount <= 4) return 2
  return Math.min(4, Math.ceil(Math.sqrt(itemCount)))
}

/** 为组成员规划稳定的阅读顺序网格，避免保留选中前的凌乱绝对位置。 */
export function planGroupLayout(items: GroupLayoutItem[]): PlannedGroupLayout | null {
  if (items.length === 0) return null
  const ordered = [...items].sort(
    (left, right) =>
      left.absoluteY - right.absoluteY ||
      left.absoluteX - right.absoluteX ||
      left.id.localeCompare(right.id),
  )
  const columns = columnCountFor(ordered.length)
  const rows = Math.ceil(ordered.length / columns)
  const columnWidths = Array.from({ length: columns }, () => 0)
  const rowHeights = Array.from({ length: rows }, () => 0)
  ordered.forEach((item, index) => {
    const column = index % columns
    const row = Math.floor(index / columns)
    columnWidths[column] = Math.max(columnWidths[column] ?? 0, item.width)
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, item.height)
  })

  const columnOffsets = columnWidths.map(
    (_, index) =>
      columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0) +
      index * GROUP_LAYOUT_GAP_X,
  )
  const rowOffsets = rowHeights.map(
    (_, index) =>
      rowHeights.slice(0, index).reduce((sum, height) => sum + height, 0) +
      index * GROUP_LAYOUT_GAP_Y,
  )
  const contentLeft = Math.min(...items.map((item) => item.absoluteX))
  const contentTop = Math.min(...items.map((item) => item.absoluteY))
  const x = contentLeft - GROUP_LAYOUT_PADDING_X
  const y = contentTop - GROUP_LAYOUT_HEADER_HEIGHT
  const contentWidth =
    columnWidths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, columns - 1) * GROUP_LAYOUT_GAP_X
  const contentHeight =
    rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows - 1) * GROUP_LAYOUT_GAP_Y

  return {
    x,
    y,
    width: Math.max(360, contentWidth + GROUP_LAYOUT_PADDING_X * 2),
    height: Math.max(220, GROUP_LAYOUT_HEADER_HEIGHT + contentHeight + GROUP_LAYOUT_PADDING_BOTTOM),
    members: ordered.map((item, index) => ({
      id: item.id,
      x: GROUP_LAYOUT_PADDING_X + (columnOffsets[index % columns] ?? 0),
      y: GROUP_LAYOUT_HEADER_HEIGHT + (rowOffsets[Math.floor(index / columns)] ?? 0),
    })),
  }
}
