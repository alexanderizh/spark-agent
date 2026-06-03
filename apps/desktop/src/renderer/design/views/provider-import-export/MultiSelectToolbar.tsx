/**
 * MultiSelectToolbar — Provider 多选模式下的批量操作工具栏
 *
 * 行为：
 *   - 仅在 multiSelect=true 时渲染
 *   - 显示当前已选 N 个 + 全选/取消/反选按钮 + 主操作（导出/删除）
 *   - 切换为单选模式时清空选中集合
 *
 * 设计：
 *   - 不绑定具体数据；纯受控组件
 *   - 主操作按钮由 caller 注入（保持组件薄）
 */
import React from 'react'
import { Icons } from '../../Icons'

export interface MultiSelectToolbarProps {
  selectedCount: number
  totalCount: number
  /** 至少一个被选中时启用主操作 */
  hasSelection: boolean
  onSelectAll: () => void
  onClearSelection: () => void
  onInvertSelection: () => void
  onExitMultiSelect: () => void
  onExportSelected: () => void
  onDeleteSelected: () => void
  deleting?: boolean
}

function MultiSelectToolbar({
  selectedCount,
  totalCount,
  hasSelection,
  onSelectAll,
  onClearSelection,
  onInvertSelection,
  onExitMultiSelect,
  onExportSelected,
  onDeleteSelected,
  deleting = false,
}: MultiSelectToolbarProps) {
  return (
    <div className="multi-select-toolbar" role="toolbar" aria-label="批量操作">
      <button
        className="icon-btn"
        onClick={onExitMultiSelect}
        title="退出多选模式"
        aria-label="退出多选模式"
      >
        <Icons.X size={13} />
      </button>
      <span className="multi-select-count" aria-live="polite">
        已选 <strong>{selectedCount}</strong> / {totalCount}
      </span>
      <div className="row row-gap-xs">
        <button className="btn ghost sm" onClick={onSelectAll} title="全选">
          全选
        </button>
        <button
          className="btn ghost sm"
          onClick={onInvertSelection}
          title="反选"
          disabled={totalCount === 0}
        >
          反选
        </button>
        <button
          className="btn ghost sm"
          onClick={onClearSelection}
          title="清空选择"
          disabled={!hasSelection}
        >
          取消选择
        </button>
      </div>
      <span className="flex1" />
      <button
        className="btn ghost sm"
        onClick={onExportSelected}
        disabled={!hasSelection}
        title="导出选中的 Provider"
      >
        <Icons.Download size={12} /> 导出选中
      </button>
      <button
        className="btn ghost sm danger"
        onClick={onDeleteSelected}
        disabled={!hasSelection || deleting}
        title="删除选中的 Provider"
      >
        <Icons.Trash size={12} /> {deleting ? '删除中…' : '删除选中'}
      </button>
    </div>
  )
}

export default MultiSelectToolbar
