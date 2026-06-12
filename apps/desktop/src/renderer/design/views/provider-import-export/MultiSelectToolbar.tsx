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
 *   - 全部使用 Arco Design Button + Icon，符合 AGENTS.md 强制规则
 */
import { Button } from '@arco-design/web-react'
import {
  IconClose, IconCheck, IconDownload, IconDelete,
} from '@arco-design/web-react/icon'

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
    <div className="pv_multi_toolbar flex items-center" role="toolbar" aria-label="批量操作">
      <Button
        size="mini"
        shape="circle"
        icon={<IconClose />}
        onClick={onExitMultiSelect}
        title="退出多选模式"
        aria-label="退出多选模式"
      />
      <span className="pv_multi_count" aria-live="polite">
        已选 <strong>{selectedCount}</strong> / {totalCount}
      </span>
      <Button size="mini" onClick={onSelectAll} title="全选">
        全选
      </Button>
      <Button
        size="mini"
        onClick={onInvertSelection}
        title="反选"
        disabled={totalCount === 0}
      >
        反选
      </Button>
      <Button
        size="mini"
        onClick={onClearSelection}
        title="清空选择"
        disabled={!hasSelection}
      >
        取消选择
      </Button>
      <span className="flex-1" />
      <Button
        size="mini"
        type="outline"
        icon={<IconDownload />}
        onClick={onExportSelected}
        disabled={!hasSelection}
        title="导出选中的 Provider"
      >
        导出选中
      </Button>
      <Button
        size="mini"
        status="danger"
        type="outline"
        icon={<IconDelete />}
        onClick={onDeleteSelected}
        disabled={!hasSelection || deleting}
        title="删除选中的 Provider"
      >
        {deleting ? '删除中…' : '删除选中'}
      </Button>
    </div>
  )
}

export default MultiSelectToolbar
