import { useEffect, useMemo, useState } from 'react'
import { InputNumber, Modal, Tooltip, message } from 'antd'
import { normalizeEduAssetUrl } from '@spark/shared'
import { Icons } from '../../Icons'
import { buildGridCells, gridCellKey, type CanvasGridCell } from './canvasGridSplit'
import type { CanvasNode } from './canvas.types'
import './CanvasGridSplitModal.less'

type GridPresetKey = '2x2' | '3x3' | '4x4' | '5x5' | 'custom'

type GridPreset = {
  key: GridPresetKey
  label: string
  rows: number
  cols: number
}

const GRID_PRESETS: GridPreset[] = [
  { key: '2x2', label: '4宫格 (2x2)', rows: 2, cols: 2 },
  { key: '3x3', label: '9宫格 (3x3)', rows: 3, cols: 3 },
  { key: '4x4', label: '16宫格 (4x4)', rows: 4, cols: 4 },
  { key: '5x5', label: '25宫格 (5x5)', rows: 5, cols: 5 },
]

export type CanvasGridSplitTile = {
  key: string
  label: string
  row: number
  col: number
  width: number
  height: number
  dataUrl: string
}

export function CanvasGridSplitModal({
  open,
  node,
  onCancel,
  onComplete,
}: {
  open: boolean
  node: CanvasNode | null
  onCancel: () => void
  onComplete: (input: {
    sourceNode: CanvasNode
    rows: number
    cols: number
    selectedTiles: CanvasGridSplitTile[]
  }) => void
}) {
  const [preset, setPreset] = useState<GridPresetKey>('3x3')
  const [customRows, setCustomRows] = useState(3)
  const [customCols, setCustomCols] = useState(3)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [readySrc, setReadySrc] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null)

  const src = useMemo(
    () => normalizeEduAssetUrl(node?.data.thumbnailUrl ?? node?.data.url ?? ''),
    [node],
  )

  const rows = preset === 'custom' ? customRows : (GRID_PRESETS.find((item) => item.key === preset)?.rows ?? 3)
  const cols = preset === 'custom' ? customCols : (GRID_PRESETS.find((item) => item.key === preset)?.cols ?? 3)

  const cells = useMemo<CanvasGridCell[]>(
    () =>
      naturalSize
        ? buildGridCells(naturalSize.width, naturalSize.height, rows, cols)
        : Array.from({ length: rows * cols }, (_, index) => {
            const row = Math.floor(index / cols)
            const col = index % cols
            return {
              key: gridCellKey(row, col),
              label: `${row + 1}-${col + 1}`,
              row,
              col,
              x: 0,
              y: 0,
              width: 1,
              height: 1,
            }
          }),
    [cols, naturalSize, rows],
  )

  useEffect(() => {
    if (!open || !src) return
    setStatus('loading')
    setReadySrc(null)
    setNaturalSize(null)
    setImageElement(null)
    setPreset('3x3')
    setCustomRows(3)
    setCustomCols(3)
    setSelectedKeys([])
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      setImageElement(image)
      setNaturalSize({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      })
      setReadySrc(src)
      setStatus('idle')
    }
    image.onerror = () => {
      setStatus('error')
      message.error('图片加载失败，无法进行宫格切分')
    }
    image.src = src
  }, [open, src])

  useEffect(() => {
    setSelectedKeys(cells.map((cell) => cell.key))
  }, [cells])

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys])

  const toggleCell = (cellKey: string) => {
    setSelectedKeys((prev) =>
      prev.includes(cellKey) ? prev.filter((item) => item !== cellKey) : [...prev, cellKey],
    )
  }

  const handleComplete = () => {
    if (!node || !imageElement || selectedKeys.length === 0) return
    const selectedTiles = cells
      .filter((cell) => selectedSet.has(cell.key))
      .map((cell) => {
        const canvas = document.createElement('canvas')
        canvas.width = cell.width
        canvas.height = cell.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(
          imageElement,
          cell.x,
          cell.y,
          cell.width,
          cell.height,
          0,
          0,
          cell.width,
          cell.height,
        )
        return {
          key: cell.key,
          label: cell.label,
          row: cell.row,
          col: cell.col,
          width: cell.width,
          height: cell.height,
          dataUrl: canvas.toDataURL('image/png'),
        }
      })
      .filter((item): item is CanvasGridSplitTile => item != null)
    if (selectedTiles.length === 0) return
    onComplete({ sourceNode: node, rows, cols, selectedTiles })
  }

  return (
    <Modal
      open={open}
      footer={null}
      onCancel={onCancel}
      width="min(1080px, 94vw)"
      centered
      className="canvas-grid-split-modal"
      wrapClassName="canvas-grid-split-wrap"
      destroyOnHidden
    >
      <div className="canvas-grid-split-shell">
        <div className="canvas-grid-split-toolbar">
          <div className="canvas-grid-split-presets">
            {GRID_PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`canvas-grid-split-chip${preset === item.key ? ' active' : ''}`}
                onClick={() => setPreset(item.key)}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className={`canvas-grid-split-chip${preset === 'custom' ? ' active' : ''}`}
              onClick={() => setPreset('custom')}
            >
              自定义
            </button>
          </div>
          <div className="canvas-grid-split-custom">
            <span>行</span>
            <InputNumber
              min={1}
              max={8}
              size="middle"
              value={customRows}
              disabled={preset !== 'custom'}
              onChange={(value) => setCustomRows(Math.min(8, Math.max(1, Number(value) || 1)))}
            />
            <span>列</span>
            <InputNumber
              min={1}
              max={8}
              size="middle"
              value={customCols}
              disabled={preset !== 'custom'}
              onChange={(value) => setCustomCols(Math.min(8, Math.max(1, Number(value) || 1)))}
            />
          </div>
          <div className="canvas-grid-split-quick-actions">
            <Tooltip title="全选当前宫格">
              <button
                type="button"
                className="canvas-grid-split-mini-btn"
                onClick={() => setSelectedKeys(cells.map((cell) => cell.key))}
              >
                全选
              </button>
            </Tooltip>
            <Tooltip title="清空选择">
              <button
                type="button"
                className="canvas-grid-split-mini-btn"
                onClick={() => setSelectedKeys([])}
              >
                清空
              </button>
            </Tooltip>
            <Tooltip title="反选">
              <button
                type="button"
                className="canvas-grid-split-mini-btn"
                onClick={() =>
                  setSelectedKeys(cells.filter((cell) => !selectedSet.has(cell.key)).map((cell) => cell.key))
                }
              >
                反选
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="canvas-grid-split-stage">
          <div className="canvas-grid-split-preview-frame">
            {readySrc && status === 'idle' ? (
              <div className="canvas-grid-split-preview">
                <img src={readySrc} alt={node?.title ?? 'grid split'} />
                <div
                  className="canvas-grid-split-overlay"
                  style={{
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                  }}
                >
                  {cells.map((cell) => {
                    const selected = selectedSet.has(cell.key)
                    return (
                      <button
                        key={cell.key}
                        type="button"
                        className={`canvas-grid-split-cell${selected ? ' active' : ''}`}
                        onClick={() => toggleCell(cell.key)}
                      >
                        <span className="canvas-grid-split-cell-label">{cell.label}</span>
                        {selected ? (
                          <span className="canvas-grid-split-cell-check">
                            <Icons.Check size={14} />
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {status === 'loading' ? (
              <div className="canvas-grid-split-status">
                <Icons.Spinner size={28} />
                <span>加载图片中…</span>
              </div>
            ) : null}
            {status === 'error' ? (
              <div className="canvas-grid-split-status is-error">
                <Icons.Image size={36} />
                <span>图片加载失败，无法切分</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="canvas-grid-split-footer">
          <div className="canvas-grid-split-summary">
            <span>当前宫格：{rows} × {cols}</span>
            <span>已保留 {selectedKeys.length} 块</span>
          </div>
          <div className="canvas-grid-split-actions">
            <button type="button" className="canvas-grid-split-action is-ghost" onClick={onCancel}>
              取消
            </button>
            <button
              type="button"
              className="canvas-grid-split-action is-primary"
              onClick={handleComplete}
              disabled={status !== 'idle' || readySrc !== src || selectedKeys.length === 0}
            >
              <Icons.Scissors size={16} />
              <span>生成切分结果</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
