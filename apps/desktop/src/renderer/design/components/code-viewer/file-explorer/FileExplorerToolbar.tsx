/**
 * 文件树顶部工具栏：工作区名 + 新建文件/文件夹 + 切换搜索面板 + 折叠全部 + 刷新。
 * 纯展示 + 事件转发，不含业务状态。
 */

import type { ReactNode } from 'react'
import { Icons } from '../../../Icons'

export interface FileExplorerToolbarProps {
  workspaceLabel: string
  onNewFile: () => void
  onNewDirectory: () => void
  /** 切换到全局搜索面板（文件名 + 内容搜索，替代原树内过滤） */
  onOpenSearch: () => void
  onCollapseAll: () => void
  onRefresh: () => void
}

export function FileExplorerToolbar({
  workspaceLabel,
  onNewFile,
  onNewDirectory,
  onOpenSearch,
  onCollapseAll,
  onRefresh,
}: FileExplorerToolbarProps): ReactNode {
  return (
    <div className="fe-toolbar">
      <span className="fe-toolbar-label" title={workspaceLabel}>
        {workspaceLabel || '项目文件'}
      </span>
      <span className="fe-toolbar-spacer" />
      <button type="button" className="fe-tool-btn" title="新建文件" onClick={onNewFile}>
        <Icons.FilePlus size={14} />
      </button>
      <button type="button" className="fe-tool-btn" title="新建文件夹" onClick={onNewDirectory}>
        <Icons.FolderPlus size={14} />
      </button>
      <button
        type="button"
        className="fe-tool-btn"
        title="切换到搜索面板（文件名 / 内容搜索）"
        onClick={onOpenSearch}
      >
        <Icons.Search size={14} />
      </button>
      <button type="button" className="fe-tool-btn" title="折叠全部" onClick={onCollapseAll}>
        <Icons.ChevronRight size={14} className="fe-collapse-all-icon" />
      </button>
      <button type="button" className="fe-tool-btn" title="刷新" onClick={onRefresh}>
        <Icons.Refresh size={14} />
      </button>
    </div>
  )
}
