import { useEffect, useRef, useState } from 'react'
import './CanvasGridSelectionMatrix.less'

export type GridCell = { col: number; row: number }

export type GridSelection = {
  left: number
  top: number
  right: number
  bottom: number
  cols: number
  rows: number
}

const DEFAULT_MAX_COLS = 8
const DEFAULT_MAX_ROWS = 6

/**
 * 归一化两个格子构成的矩形，返回边界与宽高。纯函数，便于单测。
 */
export function normalizeGridRect(a: GridCell, b: GridCell): GridSelection {
  const left = Math.min(a.col, b.col)
  const right = Math.max(a.col, b.col)
  const top = Math.min(a.row, b.row)
  const bottom = Math.max(a.row, b.row)
  return { left, top, right, bottom, cols: right - left + 1, rows: bottom - top + 1 }
}

export function isCellInSelection(cell: GridCell, sel: GridSelection | null): boolean {
  if (!sel) return false
  return (
    cell.col >= sel.left && cell.col <= sel.right && cell.row >= sel.top && cell.row <= sel.bottom
  )
}

export type CanvasGridSelectionMatrixProps = {
  nodeCount: number
  columns: number
  onChange: (columns: number) => void
  /** 矩阵最多显示几列，默认 8 */
  maxCols?: number
  /** 矩阵最多显示几行，默认 6 */
  maxRows?: number
}

/**
 * 网格拖选矩阵：鼠标按下并拖动框选一个矩形区域，
 * 横轴列数即「每排数量」(columns)，与底层 arrangeNodes({columns}) 对齐。
 * 单击任意格子：取该格横轴序号 + 1 作为列数（类似 Excel 选列）。
 */
export function CanvasGridSelectionMatrix({
  nodeCount,
  columns,
  onChange,
  maxCols = DEFAULT_MAX_COLS,
  maxRows = DEFAULT_MAX_ROWS,
}: CanvasGridSelectionMatrixProps) {
  const cols = Math.max(1, Math.min(maxCols, nodeCount))
  const rows = Math.max(1, Math.min(maxRows, nodeCount))

  const [dragStart, setDragStart] = useState<GridCell | null>(null)
  const [dragEnd, setDragEnd] = useState<GridCell | null>(null)
  const [committedSelection, setCommittedSelection] = useState<GridSelection | null>(null)
  const stateRef = useRef<{ dragStart: GridCell | null; dragEnd: GridCell | null }>({
    dragStart: null,
    dragEnd: null,
  })
  const matrixRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      const { dragStart: start, dragEnd: end } = stateRef.current
      if (!start) return
      // 拖出矩阵区域松开 = 取消，不提交：避免拖到工具栏其他按钮上误改列数，
      // 同时防止吞掉目标按钮的 click（mousedown 不在目标上则 click 不触发）。
      const matrixEl = matrixRef.current
      if (matrixEl && event.target instanceof Node && !matrixEl.contains(event.target)) {
        stateRef.current = { dragStart: null, dragEnd: null }
        setDragStart(null)
        setDragEnd(null)
        return
      }
      const moved = end && (end.col !== start.col || end.row !== start.row)
      if (moved && end) {
        const nextSelection = normalizeGridRect(start, end)
        setCommittedSelection(nextSelection)
        onChange(nextSelection.cols)
      } else {
        // 单击未拖动：取起点横轴序号 + 1 作为列数
        setCommittedSelection(normalizeGridRect(start, start))
        onChange(start.col + 1)
      }
      stateRef.current = { dragStart: null, dragEnd: null }
      setDragStart(null)
      setDragEnd(null)
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [onChange])

  const selection =
    dragStart && dragEnd ? normalizeGridRect(dragStart, dragEnd) : committedSelection
  // hint 始终用「实际行数 = ceil(nodeCount / 列数)」，而非拖选矩形的行数：
  // 矩阵最多渲染 maxRows 行，拖选行数会被截断，直接显示会误导。
  const activeCols = selection ? selection.cols : columns
  const actualRows = Math.max(1, Math.ceil(nodeCount / Math.max(1, activeCols)))
  const hint = `每排 ${activeCols} 个 · 共 ${actualRows} 排`

  const handleMouseDown = (cell: GridCell) => {
    stateRef.current = { dragStart: cell, dragEnd: cell }
    setDragStart(cell)
    setDragEnd(cell)
  }
  const handleMouseEnter = (cell: GridCell) => {
    if (stateRef.current.dragStart) {
      stateRef.current.dragEnd = cell
      setDragEnd(cell)
    }
  }

  return (
    <div ref={matrixRef} className="canvas-grid-selection" role="group" aria-label="拖选网格规格">
      <div
        className="canvas-grid-selection-matrix"
        style={{ gridTemplateColumns: `repeat(${cols}, var(--canvas-grid-cell, 18px))` }}
      >
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => {
            const cell = { col: c, row: r }
            const active = isCellInSelection(cell, selection)
            return (
              <span
                key={`${c}-${r}`}
                className={`canvas-grid-selection-cell${active ? ' is-active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                  handleMouseDown(cell)
                }}
                onMouseEnter={() => handleMouseEnter(cell)}
              />
            )
          }),
        )}
      </div>
      <div className="canvas-grid-selection-hint">{hint}</div>
    </div>
  )
}
