import { Button } from '@lobehub/ui'
import { InputNumber } from 'antd'
import { Icons } from '../../Icons'
import { CanvasGridSelectionMatrix } from './CanvasGridSelectionMatrix'
import './CanvasGridArrangePanel.less'

export type CanvasGridArrangePanelProps = {
  nodeCount: number
  columns: number
  onColumnsChange: (next: number) => void
  onApply: () => void
  applying?: boolean
  title?: string
  description?: string
  applyLabel?: string
  fullWidth?: boolean
}

/**
 * 网格排列下拉面板：
 * 1) 拖选矩阵 —— 鼠标框选一个区域，横轴列数即「每排数量」
 * 2) 数值输入 —— 精确指定每排数量，与矩阵双向同步
 * 复用 arrangeNodes({ mode: 'grid', columns }) —— 与右上角自动整理同一算法。
 */
export function CanvasGridArrangePanel({
  nodeCount,
  columns,
  onColumnsChange,
  onApply,
  applying = false,
  title = '网格排列',
  description,
  applyLabel = '应用网格排列',
  fullWidth = false,
}: CanvasGridArrangePanelProps) {
  const maxColumns = Math.max(1, nodeCount)
  const safeColumns = Math.min(Math.max(1, Math.round(columns) || 1), maxColumns)
  const rowCount = Math.ceil(nodeCount / safeColumns)

  return (
    <div
      className={`canvas-grid-arrange-panel${fullWidth ? ' is-full-width' : ''}`}
      role="dialog"
      aria-label="网格排列"
    >
      <div className="canvas-grid-arrange-header">
        <span className="canvas-grid-arrange-title">{title}</span>
        <span className="canvas-grid-arrange-count">{nodeCount} 个节点</span>
      </div>
      {description && <div className="canvas-grid-arrange-description">{description}</div>}

      <CanvasGridSelectionMatrix
        nodeCount={nodeCount}
        columns={safeColumns}
        onChange={onColumnsChange}
      />

      <div className="canvas-grid-arrange-field">
        <span className="canvas-grid-arrange-label">每排数量</span>
        <InputNumber
          className="canvas-grid-arrange-input"
          size="small"
          min={1}
          max={maxColumns}
          step={1}
          value={safeColumns}
          onChange={(value) => {
            if (typeof value === 'number' && Number.isFinite(value)) {
              onColumnsChange(value)
            }
          }}
        />
        <span className="canvas-grid-arrange-rows">共 {rowCount} 排</span>
      </div>

      <Button
        type="primary"
        size="small"
        block
        loading={applying}
        icon={<Icons.Grid size={14} />}
        onClick={onApply}
      >
        {applyLabel}
      </Button>
    </div>
  )
}
