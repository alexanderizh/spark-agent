/**
 * SidebarGitFooter —— 编辑器左侧栏公用 foot 栏：当前分支 + 待同步数量（↑ahead ↓behind）
 * + 同步/发布按钮。文件树 / 搜索 / Git 三个面板共用同一槽位，因此挂在其父容器
 * （.cv-explorer）底部而不是任何单个面板内部。
 * 点击同步：已有 upstream 时先拉取后推送；本地新分支（未发布，branchHasUpstream 为
 * false）按钮切换为「发布」，点击直接推送并建立同名远端分支（push -u）。
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
  onPublish,
}: {
  status: WorkspaceGitStatusResponse | null
  busy: boolean
  onSync: () => void
  /** 发布本地新分支：推送当前分支并以 -u 建立同名远端上游 */
  onPublish: () => void
}) {
  const branch = status?.currentBranch ?? '-'
  const ahead = status?.ahead ?? 0
  const behind = status?.behind ?? 0
  const hasRemote = status?.hasRemote === true
  const pending = ahead > 0 || behind > 0
  // 有远端但当前分支没有上游 = 本地新建分支尚未发布；此时 ahead/behind 是相对远端
  // 默认分支的兜底对比值，精确动作是"发布"而非"同步"。
  // 分离头指针下 currentBranch 是 tag/短 SHA，不构成可发布的分支，保持"同步"语义。
  const needsPublish =
    hasRemote && status?.branchHasUpstream === false && status?.detachedHead !== true
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
        className={`gp-sync-btn${pending || needsPublish ? ' pending' : ''}`}
        title={
          !hasRemote
            ? '当前仓库没有配置远端'
            : needsPublish
              ? '发布：推送当前分支并以同名分支建立远端上游'
              : '同步：先拉取后推送'
        }
        disabled={!hasRemote || busy}
        onClick={needsPublish ? onPublish : onSync}
      >
        {busy ? (
          <Icons.Spinner size={13} className="gp-spin" />
        ) : needsPublish ? (
          <Icons.Upload size={13} />
        ) : (
          <Icons.RotateCw size={13} />
        )}
        {needsPublish ? '发布' : '同步'}
      </button>
    </div>
  )
}
