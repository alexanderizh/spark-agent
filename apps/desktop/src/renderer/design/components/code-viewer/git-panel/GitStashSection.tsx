/**
 * GitStashSection —— 贮藏（stash）分组：条目 = 消息 + 相对时间，
 * hover 提供「恢复（pop）」与「丢弃（drop，二次确认）」。
 */

import type { WorkspaceGitStashEntry } from '@spark/protocol'
import { Icons } from '../../../Icons'
import { formatGitRelativeTime } from './gitPanelViewUtils'

export function GitStashSection({
  entries,
  collapsed,
  busy,
  onToggle,
  onPop,
  onDropRequest,
}: {
  entries: WorkspaceGitStashEntry[]
  collapsed: boolean
  busy: boolean
  onToggle: () => void
  onPop: (selector: string) => void
  onDropRequest: (selector: string, label: string) => void
}) {
  return (
    <div className={`gp-group${collapsed ? ' collapsed' : ''}`}>
      <div className="gp-group-head">
        <button type="button" className="gp-group-title" onClick={onToggle}>
          <Icons.ChevronDown size={13} className="gp-chevron" />
          <span className="gp-group-dot accent" />
          <span>贮藏</span>
          <span className="gp-group-count">{entries.length}</span>
        </button>
      </div>
      {!collapsed && (
        <div className="gp-group-body">
          {entries.map((entry) => (
            <div
              className="gp-file-row"
              key={entry.selector}
              title={entry.message || entry.selector}
            >
              <span className="gp-stash-main">
                <Icons.Archive size={13} className="gp-stash-icon" />
                <span className="gp-file-name">{entry.message || '未命名 stash'}</span>
              </span>
              <span className="gp-file-stats gp-stash-time">
                {formatGitRelativeTime(entry.date)}
              </span>
              <span className="gp-file-actions">
                <button
                  type="button"
                  className="gp-icon-btn"
                  title={`恢复 ${entry.selector}（pop 到工作区）`}
                  disabled={busy}
                  onClick={() => onPop(entry.selector)}
                >
                  <Icons.Download size={13} />
                </button>
                <button
                  type="button"
                  className="gp-icon-btn danger"
                  title={`丢弃 ${entry.selector}`}
                  disabled={busy}
                  onClick={() => onDropRequest(entry.selector, entry.message || entry.selector)}
                >
                  <Icons.Trash size={13} />
                </button>
              </span>
            </div>
          ))}
          {entries.length === 0 && <div className="gp-group-empty">暂无贮藏</div>}
        </div>
      )}
    </div>
  )
}
