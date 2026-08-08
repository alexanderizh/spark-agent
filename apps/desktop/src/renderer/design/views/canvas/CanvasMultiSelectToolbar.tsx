import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { Button, Tooltip } from '@lobehub/ui'
import { Popover } from 'antd'
import { Icons } from '../../Icons'
import { CanvasGridArrangePanel } from './CanvasGridArrangePanel'
import type { CanvasAlignmentMode } from './canvasAlignment'
import './CanvasMultiSelectToolbar.less'

type IconComponent = ComponentType<{ size?: number }>
type AlignItem = { mode: CanvasAlignmentMode; Icon: IconComponent; label: string }

const HORIZONTAL_ALIGN: AlignItem[] = [
  { mode: 'left', Icon: Icons.AlignLeft, label: '左对齐' },
  { mode: 'center-horizontal', Icon: Icons.AlignCenterHorizontal, label: '水平居中' },
  { mode: 'right', Icon: Icons.AlignRight, label: '右对齐' },
  { mode: 'distribute-horizontal', Icon: Icons.DistributeHorizontal, label: '水平等距分布' },
]

const VERTICAL_ALIGN: AlignItem[] = [
  { mode: 'top', Icon: Icons.AlignTop, label: '顶对齐' },
  { mode: 'center-vertical', Icon: Icons.AlignVerticalCenter, label: '垂直居中' },
  { mode: 'bottom', Icon: Icons.AlignBottom, label: '底对齐' },
  { mode: 'distribute-vertical', Icon: Icons.DistributeVertical, label: '垂直等距分布' },
]

export type CanvasMultiSelectToolbarProps = {
  selectedCount: number
  canCreateGroup: boolean
  canMergeSelectionToImage: boolean
  canBatchConfigureTasks: boolean
  canBatchSubmitTasks: boolean
  batchTaskConfigureDisabledReason?: string | null
  batchTaskSubmitDisabledReason?: string | null
  arranging: boolean
  onExtractSelectionToWorkflow?: () => void
  onConfigureSelectedTasks?: () => void
  onSubmitSelectedTasks?: () => void
  onAddNodesToAgent?: () => void
  onCreateGroup: () => void
  onMergeSelectionToImage?: () => void
  onAlign: (mode: CanvasAlignmentMode) => void
  onArrangeGrid: (columns: number) => void
  onDuplicate?: () => void
  onDelete?: () => void
  /**
   * Popover 面板相对工具栏的弹出方向：'bottom'（默认，面板在工具栏下方）或 'top'。
   * 工具栏浮在选区上方时面板朝下弹；翻转到选区下方时面板朝上弹，避免被画布底边裁切。
   */
  popoverSide?: 'top' | 'bottom'
}

function IconToolbarButton({
  label,
  icon,
  onClick,
  disabled = false,
  disabledReason,
  danger = false,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  disabledReason?: string | null
  danger?: boolean
}) {
  return (
    <Tooltip title={disabled && disabledReason ? disabledReason : label}>
      <Button
        size="small"
        type="text"
        className={`canvas-node-toolbar-button canvas-multi-select-toolbar-btn${danger ? ' canvas-node-toolbar-button-danger' : ''}`}
        icon={icon}
        aria-label={label}
        disabled={disabled}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onClick()
        }}
      />
    </Tooltip>
  )
}

function autoColumnCount(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))))
}

/**
 * 多选节点浮动工具栏（编组 / 对齐 / 网格排列 / 复制 / 删除）。
 * 组件本身只渲染内容；定位（跟随选区包围盒）由父容器通过 style 控制。
 */
export function CanvasMultiSelectToolbar({
  selectedCount,
  canCreateGroup,
  canMergeSelectionToImage,
  canBatchConfigureTasks,
  canBatchSubmitTasks,
  batchTaskConfigureDisabledReason,
  batchTaskSubmitDisabledReason,
  arranging,
  onExtractSelectionToWorkflow,
  onConfigureSelectedTasks,
  onSubmitSelectedTasks,
  onAddNodesToAgent,
  onCreateGroup,
  onMergeSelectionToImage,
  onAlign,
  onArrangeGrid,
  onDuplicate,
  onDelete,
  popoverSide = 'bottom',
}: CanvasMultiSelectToolbarProps) {
  const alignPlacement = popoverSide === 'top' ? 'topLeft' : 'bottomLeft'
  const gridPlacement = popoverSide === 'top' ? 'top' : 'bottom'
  const [alignOpen, setAlignOpen] = useState(false)
  const [gridOpen, setGridOpen] = useState(false)
  const [gridColumns, setGridColumns] = useState(() => autoColumnCount(selectedCount))

  // 选区节点数变化时，仅在当前列数超出新选区可容纳范围 [1, selectedCount] 时收窄，
  // 不强制重置为 sqrt —— 保留用户手动设定的列数。
  useEffect(() => {
    setGridColumns((prev) => {
      const maxColumns = Math.max(1, selectedCount)
      if (prev < 1) return 1
      if (prev > maxColumns) return maxColumns
      return prev
    })
  }, [selectedCount])

  const handleAlignClick = (mode: CanvasAlignmentMode) => {
    setAlignOpen(false)
    onAlign(mode)
  }

  const handleApplyGrid = () => {
    setGridOpen(false)
    onArrangeGrid(Math.max(1, Math.round(gridColumns) || 1))
  }

  const renderAlignRow = (label: string, items: AlignItem[]) => (
    <div className="canvas-multi-select-align-row" key={label}>
      <span className="canvas-multi-select-align-label">{label}</span>
      <div className="canvas-multi-select-align-buttons">
        {items.map((item) => (
          <Tooltip key={item.mode} title={item.label}>
            <Button
              size="small"
              type="text"
              className="canvas-multi-select-align-btn"
              aria-label={item.label}
              icon={<item.Icon size={15} />}
              onClick={() => handleAlignClick(item.mode)}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  )

  const alignContent = (
    <div className="canvas-multi-select-align-panel" role="dialog" aria-label="对齐与分布">
      {renderAlignRow('水平', HORIZONTAL_ALIGN)}
      {renderAlignRow('垂直', VERTICAL_ALIGN)}
    </div>
  )

  const gridContent = (
    <CanvasGridArrangePanel
      nodeCount={selectedCount}
      columns={gridColumns}
      onColumnsChange={setGridColumns}
      onApply={handleApplyGrid}
      applying={arranging}
    />
  )

  const showTaskActions = onConfigureSelectedTasks != null || onSubmitSelectedTasks != null

  return (
    <div
      className="canvas-node-toolbar-surface canvas-multi-select-toolbar"
      role="toolbar"
      aria-label="多选节点工具栏"
    >
      {onExtractSelectionToWorkflow && (
        <IconToolbarButton
          label={`提取为画布工作流（${selectedCount}）`}
          icon={<Icons.Workflow size={15} />}
          onClick={onExtractSelectionToWorkflow}
        />
      )}

      {showTaskActions && <span className="canvas-node-toolbar-divider" />}

      {onConfigureSelectedTasks && (
        <IconToolbarButton
          label="批量配置参数…"
          icon={<Icons.Sliders size={15} />}
          disabled={!canBatchConfigureTasks}
          {...(batchTaskConfigureDisabledReason !== undefined
            ? { disabledReason: batchTaskConfigureDisabledReason }
            : {})}
          onClick={onConfigureSelectedTasks}
        />
      )}
      {onSubmitSelectedTasks && (
        <IconToolbarButton
          label="批量提交运行"
          icon={<Icons.Play size={15} />}
          disabled={!canBatchSubmitTasks}
          {...(batchTaskSubmitDisabledReason !== undefined
            ? { disabledReason: batchTaskSubmitDisabledReason }
            : {})}
          onClick={onSubmitSelectedTasks}
        />
      )}

      {(onExtractSelectionToWorkflow || showTaskActions) && onAddNodesToAgent && (
        <span className="canvas-node-toolbar-divider" />
      )}

      {onAddNodesToAgent && (
        <IconToolbarButton
          label={`添加到 Agent 对话${selectedCount > 1 ? `（${selectedCount}）` : ''}`}
          icon={<Icons.MessageSquarePlus size={15} />}
          onClick={onAddNodesToAgent}
        />
      )}

      {(onExtractSelectionToWorkflow || showTaskActions || onAddNodesToAgent) && (
        <span className="canvas-node-toolbar-divider" />
      )}

      {onDuplicate && (
        <IconToolbarButton
          label={`复制选中节点${selectedCount > 1 ? `（${selectedCount}）` : ''}`}
          icon={<Icons.Copy size={15} />}
          onClick={onDuplicate}
        />
      )}

      {canCreateGroup && (
        <IconToolbarButton
          label="创建组"
          icon={<Icons.Group size={15} />}
          onClick={onCreateGroup}
        />
      )}

      <Popover
        trigger="click"
        placement={alignPlacement}
        open={alignOpen}
        onOpenChange={(open) => !arranging && setAlignOpen(open)}
        content={alignContent}
      >
        <Tooltip title="对齐与分布">
          <Button
            size="small"
            type="text"
            className={`canvas-node-toolbar-button canvas-multi-select-toolbar-btn${alignOpen ? ' is-active' : ''}`}
            icon={<Icons.AlignCenterHorizontal size={15} />}
            aria-label="对齐与分布"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
        </Tooltip>
      </Popover>

      <Popover
        trigger="click"
        placement={gridPlacement}
        open={gridOpen}
        onOpenChange={(open) => !arranging && setGridOpen(open)}
        content={gridContent}
      >
        <Tooltip title="网格排列">
          <Button
            size="small"
            type="text"
            className={`canvas-node-toolbar-button canvas-multi-select-toolbar-btn${gridOpen ? ' is-active' : ''}`}
            icon={<Icons.Grid size={15} />}
            aria-label="网格排列"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          />
        </Tooltip>
      </Popover>

      {onMergeSelectionToImage && canMergeSelectionToImage && (
        <IconToolbarButton
          label="合并为组合图"
          icon={<Icons.Image size={15} />}
          onClick={onMergeSelectionToImage}
        />
      )}

      {onDelete && <span className="canvas-node-toolbar-divider" />}

      {onDelete && (
        <IconToolbarButton
          label={`删除选中节点${selectedCount > 1 ? `（${selectedCount}）` : ''}`}
          icon={<Icons.Trash size={15} />}
          danger
          onClick={onDelete}
        />
      )}
    </div>
  )
}
