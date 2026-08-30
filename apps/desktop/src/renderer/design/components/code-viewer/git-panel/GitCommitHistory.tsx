/**
 * GitCommitHistory —— 提交板块：最近提交列表（hash + subject + 作者 + 相对时间），
 * 未推送的提交带 ↑ 标识与强调色。
 */

import type { WorkspaceGitCommitEntry } from '@spark/protocol'
import { Icons } from '../../../Icons'
import { formatGitRelativeTime } from './gitPanelViewUtils'

export function GitCommitHistory({
  commits,
  loading,
  error,
  collapsed,
  onToggle,
  onRefresh,
}: {
  commits: WorkspaceGitCommitEntry[]
  loading: boolean
  error: string | null
  collapsed: boolean
  onToggle: () => void
  onRefresh: () => void
}) {
  const unpushedCount = commits.filter((c) => c.unpushed).length
  return (
    <div className={`gp-group${collapsed ? ' collapsed' : ''}`}>
      <div className="gp-group-head">
        <button type="button" className="gp-group-title" onClick={onToggle}>
          <Icons.ChevronDown size={13} className="gp-chevron" />
          <span className="gp-group-dot muted" />
          <span>提交</span>
          <span className="gp-group-count">{commits.length}</span>
          {unpushedCount > 0 && (
            <span className="gp-unpushed-badge" title={`${unpushedCount} 条未推送`}>
              ↑{unpushedCount}
            </span>
          )}
        </button>
        <span className="gp-group-actions">
          <button
            type="button"
            className="gp-icon-btn"
            title="刷新提交记录"
            disabled={loading}
            onClick={onRefresh}
          >
            {loading ? (
              <Icons.Spinner size={13} className="gp-spin" />
            ) : (
              <Icons.RotateCw size={13} />
            )}
          </button>
        </span>
      </div>
      {!collapsed && (
        <div className="gp-group-body">
          {error != null && <div className="gp-group-error">{error}</div>}
          {error == null && loading && commits.length === 0 && (
            <div className="gp-group-empty">
              <Icons.Spinner size={13} className="gp-spin" /> 加载中…
            </div>
          )}
          {error == null &&
            !loading &&
            commits.length === 0 &&
            (collapsed ? null : <div className="gp-group-empty">暂无提交记录</div>)}
          {commits.map((commit) => (
            <div
              key={commit.hash}
              className={`gp-commit-row${commit.unpushed ? ' unpushed' : ''}`}
              title={`${commit.subject}\n${commit.authorName} · ${commit.date}`}
            >
              <span className={`gp-commit-dot${commit.unpushed ? ' unpushed' : ''}`} />
              <span className="gp-commit-hash">{commit.shortHash}</span>
              <span className="gp-commit-subject">{commit.subject}</span>
              <span className="gp-commit-meta">
                {commit.unpushed && (
                  <span className="gp-commit-up" title="未推送">
                    ↑
                  </span>
                )}
                <span className="gp-commit-author">{commit.authorName}</span>
                <span className="gp-commit-time">{formatGitRelativeTime(commit.date)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
