/**
 * GitPanelFooter —— 底部 foot 栏：当前分支 + 待同步数量（↑ahead ↓behind）+ 同步按钮。
 * 点击同步 = 先拉取后推送（与用户终端习惯一致，避免直接 push 被拒）。
 */

import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { Icons } from '../../../Icons'

export function GitPanelFooter({
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
