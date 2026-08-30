/**
 * 资产库批量操作条（步骤模式设计文档 §5.4，P2）。
 *
 * 出现在网格底部：已选计数、全选当前页、批量插入画布 / 批量下载 / 批量删除。
 * 删除等危险操作的确认弹窗由容器负责，这里只发起回调。
 */

import { Button } from '@lobehub/ui'

export type AssetBatchActionsProps = {
  selectedCount: number
  /** 当前页是否已全选（决定「全选/取消全选」文案与行为） */
  allPageSelected: boolean
  onToggleSelectPage: () => void
  onClearSelection: () => void
  onInsertSelected: () => void
  onDownloadSelected: () => void
  onDeleteSelected: () => void
  busy?: boolean
}

export function AssetBatchActions({
  selectedCount,
  allPageSelected,
  onToggleSelectPage,
  onClearSelection,
  onInsertSelected,
  onDownloadSelected,
  onDeleteSelected,
  busy = false,
}: AssetBatchActionsProps) {
  return (
    <div className="asset-library-batch-bar">
      <Button size="small" type="text" onClick={onToggleSelectPage}>
        {allPageSelected ? '取消全选' : '全选本页'}
      </Button>
      <span className="asset-library-batch-count">
        {selectedCount > 0 ? `已选 ${selectedCount} 项` : '未选择'}
      </span>
      <div className="asset-library-toolbar-spacer" />
      <Button
        size="small"
        variant="outlined"
        disabled={selectedCount === 0 || busy}
        onClick={onInsertSelected}
      >
        插入画布
      </Button>
      <Button
        size="small"
        variant="outlined"
        disabled={selectedCount === 0 || busy}
        onClick={onDownloadSelected}
      >
        下载
      </Button>
      <Button
        size="small"
        variant="outlined"
        disabled={selectedCount === 0 || busy}
        onClick={onDeleteSelected}
        style={{ color: 'var(--ast-danger)' }}
      >
        删除
      </Button>
      {selectedCount > 0 ? (
        <Button size="small" type="text" onClick={onClearSelection}>
          取消选择
        </Button>
      ) : null}
    </div>
  )
}
