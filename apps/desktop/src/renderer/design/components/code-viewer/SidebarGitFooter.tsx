/**
 * SidebarGitFooter —— 编辑器左侧栏公用 foot 栏：当前分支 + 待同步数量（↑ahead ↓behind）
 * + 同步按钮。文件树 / 搜索 / Git 三个面板共用同一槽位，因此挂在其父容器
 * （.cv-explorer）底部而不是任何单个面板内部。
 * 点击同步 = 先拉取后推送（与用户终端习惯一致，避免直接 push 被拒）。
 */

import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { Icons } from '../../Icons'

/** status 尚未加载完（null）时仍显示占位（分支 '-' + 禁用同步）；确认非 Git 仓库则整个隐藏 */
export function shouldShowSidebarGitFooter(status: WorkspaceGitStatusResponse | null): boolean {
  return status == null || status.isGitRepo === true
}

export function SidebarGitFooter({
  status,
  busy,
  onSync,
}: {
  status: WorkspaceGitStatusResponse | null
  busy: boolean
  onSync: () => void
}) {
  const branch = status?.currentBranch ?? '-'
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const hasRemote = status?.hasRemote === true
  const pending = ahead > 0 || behind > 0
  return (
    <div className="gp-footer">
      <span className="gp-footer-branch" title={`当前分支：${branch}`}>
        <Icons.GitBranch size={13} />
        <span className="truncate">{branch}</span>
      </span>
      <span className="gp-footer-sync" title={`待推送 ${ahead} · 待拉取 ${behind}`}>
        <span className={`gp-ahead${ahead > 0 ? ' has' : ''}`}>↑{ahead}</span>
        <span className={`gp-behind${behind > 0 ? ' has' : ''}`}>↓{behind}</span>
      </span>
      <button
        type="button"
        className={`gp-sync-btn${pending ? ' pending' : ''}`}
        title={hasRemote ? '同步：先拉取后推送' : '当前仓库没有配置远端'}
        disabled={!hasRemote || busy}
        onClick={onSync}
      >
        {busy ? <Icons.Spinner size={13} className="gp-spin" /> : <Icons.RotateCw size={13} />}
        同步
      </button>
    </div>
  )
}
