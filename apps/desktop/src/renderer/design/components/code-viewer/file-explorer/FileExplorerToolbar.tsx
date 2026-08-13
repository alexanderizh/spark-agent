/**
 * 文件树顶部工具栏：工作区名 + 新建文件/文件夹 + 搜索切换 + 折叠全部 + 刷新。
 * 纯展示 + 事件转发，不含业务状态。
 */

import type { ReactNode } from 'react'
import { Icons } from '../../../Icons'

export interface FileExplorerToolbarProps {
  workspaceLabel: string
  searchActive: boolean
  onNewFile: () => void
  onNewDirectory: () => void
  onToggleSearch: () => void
  onCollapseAll: () => void
  onRefresh: () => void
}

export function FileExplorerToolbar({
  workspaceLabel,
  searchActive,
  onNewFile,
  onNewDirectory,
  onToggleSearch,
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
        className={`fe-tool-btn${searchActive ? ' on' : ''}`}
        title="搜索"
        onClick={onToggleSearch}
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
