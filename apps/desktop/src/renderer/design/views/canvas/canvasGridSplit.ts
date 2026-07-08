export type CanvasGridCell = {
  key: string
  label: string
  row: number
  col: number
  x: number
  y: number
  width: number
  height: number
}

export function gridCellKey(row: number, col: number): string {
  return `${row}:${col}`
}

export function gridCellLabel(row: number, col: number): string {
  return `${row + 1}-${col + 1}`
}

export function buildGridCells(
  imageWidth: number,
  imageHeight: number,
  rows: number,
  cols: number,
): CanvasGridCell[] {
  if (imageWidth <= 0 || imageHeight <= 0 || rows <= 0 || cols <= 0) return []
  const cells: CanvasGridCell[] = []
  for (let row = 0; row < rows; row += 1) {
    const y = Math.floor((row * imageHeight) / rows)
    const nextY = Math.floor(((row + 1) * imageHeight) / rows)
    for (let col = 0; col < cols; col += 1) {
      const x = Math.floor((col * imageWidth) / cols)
      const nextX = Math.floor(((col + 1) * imageWidth) / cols)
      cells.push({
        key: gridCellKey(row, col),
        label: gridCellLabel(row, col),
        row,
        col,
        x,
        y,
        width: Math.max(1, nextX - x),
        height: Math.max(1, nextY - y),
      })
    }
  }
  return cells
}
