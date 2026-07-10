import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { Icons } from '../../Icons'
import { resolveDisplayedGitBranch } from '../chat-session-routing'
import type { BranchState } from './ChatComposerTypes'
import { formatSignedNumber } from './ChatGitUtils'

function GitDialogShell({
  children,
  className,
  onClose,
}: {
  children: ReactNode
  className?: string
  onClose: () => void
}) {
  return createPortal(
    <div
      className="git-dialog-overlay"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      role="presentation"
    >
      <div
        className={`git-dialog-card${className ? ` ${className}` : ''}`}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function GitCommitDialog({
  status,
  branchState,
  onClose,
  onCommit,
  onPush,
  onRefresh,
}: {
  status: WorkspaceGitStatusResponse | null
  branchState: BranchState
  onClose: () => void
  onCommit: (options: { message: string; includeUnstaged: boolean; push: boolean }) => Promise<void>
  onPush: () => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const [commitMessage, setCommitMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [busy, setBusy] = useState(false)
  const currentBranch = resolveDisplayedGitBranch({
    branchStateCurrentBranch: branchState.currentBranch,
    statusCurrentBranch: status?.currentBranch,
  })
  const additions = status?.additions ?? 0
  const deletions = status?.deletions ?? 0
  const changedFiles = status?.changedFiles ?? 0
  const stagedFiles = status?.stagedFiles ?? 0
  const unstagedFiles = status?.unstagedFiles ?? 0
  const aheadCommits = status?.ahead ?? 0
  const commitFileCount = includeUnstaged ? changedFiles : stagedFiles
  const canCommit =
    (includeUnstaged ? changedFiles > 0 : stagedFiles > 0) && status?.isGitRepo === true
  const canPush = status?.hasRemote === true && aheadCommits > 0

  const runCommit = async (push: boolean) => {
    if (!canCommit || busy) return
    setBusy(true)
    try {
      await onCommit({
        // 留空时由父级 handler 决定：交给 agent 或回退模板。
        message: commitMessage.trim(),
        includeUnstaged,
        push,
      })
      setCommitMessage('')
      await onRefresh()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const runPush = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onPush()
      await onRefresh()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <GitDialogShell className="git-dialog-card-commit" onClose={onClose}>
      <div className="git-dialog-header">
        <h3>{currentBranch ?? 'Git'}</h3>
        <span className="git-env-spacer" />
        <span className="git-add">+{formatSignedNumber(additions)}</span>
        <span className="git-del">-{formatSignedNumber(deletions)}</span>
        <button type="button" className="git-popover-icon" title="关闭" onClick={onClose}>
          <Icons.X size={14} />
        </button>
      </div>
      <textarea
        className="git-commit-message"
        value={commitMessage}
        onChange={(event) => setCommitMessage(event.target.value)}
        placeholder="提交信息（留空将自动生成）..."
      />
      <label className="git-checkbox-row">
        <input
          type="checkbox"
          checked={includeUnstaged}
          onChange={(event) => setIncludeUnstaged(event.target.checked)}
        />
        <span>包含未暂存的更改</span>
        <span className="git-action-count-pill">未暂存 {unstagedFiles}</span>
      </label>
      <div className="git-action-list">
        <button
          type="button"
          className="git-action-row primary"
          disabled={!canCommit || busy}
          onClick={() => void runCommit(false)}
        >
          <span className="git-env-icon">
            <Icons.CheckCircle size={14} />
          </span>
          <span>提交</span>
          <span className="git-action-meta">
            <span className="git-action-count-pill">待提交 {commitFileCount}</span>
            <span className="git-action-shortcut">⌘↩</span>
          </span>
        </button>
        <button
          type="button"
          className="git-action-row"
          disabled={!canCommit || status?.hasRemote !== true || busy}
          onClick={() => void runCommit(true)}
        >
          <span className="git-env-icon">
            <Icons.Upload size={14} />
          </span>
          <span>提交并推送</span>
          <span className="git-action-meta">
            <span className="git-action-count-pill">待提交 {commitFileCount}</span>
            <span className="git-action-count-pill">待推送 {aheadCommits}</span>
          </span>
        </button>
        <button
          type="button"
          className="git-action-row"
          disabled={!canPush || busy}
          onClick={() => void runPush()}
        >
          <span className="git-env-icon">
            <Icons.Upload size={14} />
          </span>
          <span>推送</span>
          <span className="git-action-meta">
            <span className="git-action-count-pill">待推送 {aheadCommits}</span>
          </span>
        </button>
      </div>
    </GitDialogShell>
  )
}

export function GitBranchDialog({
  status,
  branchState,
  onClose,
  onSwitchBranch,
  onOpenCreateBranch,
}: {
  status: WorkspaceGitStatusResponse | null
  branchState: BranchState
  onClose: () => void
  onSwitchBranch: (branch: string) => Promise<boolean>
  onOpenCreateBranch: () => void
}) {
  const [branchSearch, setBranchSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const currentBranch = resolveDisplayedGitBranch({
    branchStateCurrentBranch: branchState.currentBranch,
    statusCurrentBranch: status?.currentBranch,
  })
  const branchSource =
    branchState.branches.length > 0 ? branchState.branches : (status?.branches ?? [])
  const branches = Array.from(
    new Set(branchSource.filter((branch): branch is string => branch.length > 0)),
  )
  const filteredBranches = branches.filter((branch) =>
    branch.toLowerCase().includes(branchSearch.trim().toLowerCase()),
  )
  const changedFiles = status?.changedFiles ?? 0

  return (
    <GitDialogShell className="git-dialog-card-branch" onClose={onClose}>
      <div className="git-dialog-header">
        <h3>切换分支</h3>
        <button type="button" className="git-popover-icon" title="关闭" onClick={onClose}>
          <Icons.X size={14} />
        </button>
      </div>
      <div className="git-branch-search">
        <Icons.Search size={14} />
        <input
          value={branchSearch}
          onChange={(event) => setBranchSearch(event.target.value)}
          placeholder="搜索分支"
          autoFocus
        />
      </div>
      <div className="git-branch-list">
        {filteredBranches.map((branch) => (
          <button
            type="button"
            key={branch}
            className={`git-branch-row ${branch === currentBranch ? 'active' : ''}`}
            disabled={busy}
            onClick={() => {
              if (branch === currentBranch) {
                onClose()
                return
              }
              setBusy(true)
              void onSwitchBranch(branch)
                .then((switched) => {
                  if (switched) onClose()
                })
                .finally(() => setBusy(false))
            }}
          >
            <Icons.GitBranch size={14} />
            <span className="git-branch-copy">
              <span className="git-branch-name truncate">{branch}</span>
              {branch === currentBranch && changedFiles > 0 && (
                <span className="git-branch-desc">未提交：{changedFiles} 个文件</span>
              )}
            </span>
            {branch === currentBranch && <Icons.Check size={14} />}
          </button>
        ))}
        {filteredBranches.length === 0 && <div className="git-popover-muted">没有匹配分支</div>}
      </div>
      <button type="button" className="git-create-branch-btn" onClick={onOpenCreateBranch}>
        <Icons.Plus size={14} />
        <span>创建并检出新分支...</span>
      </button>
    </GitDialogShell>
  )
}

export function GitCreateBranchDialog({
  onClose,
  onCreateBranch,
}: {
  onClose: () => void
  onCreateBranch: (branch: string) => Promise<void>
}) {
  const [branchDraft, setBranchDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const branchError = branchDraft.trim().endsWith('/')
    ? '分支名不能以“/”结尾。'
    : branchDraft.trim().length === 0
      ? ''
      : /\s/.test(branchDraft.trim())
        ? '分支名不能包含空白字符。'
        : ''

  const runCreateBranch = async () => {
    const next = branchDraft.trim()
    if (!next || branchError || busy) return
    setBusy(true)
    try {
      await onCreateBranch(next)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <GitDialogShell onClose={onClose}>
      <div className="git-dialog-header">
        <h3>创建并检出分支</h3>
        <button type="button" className="git-popover-icon" title="关闭" onClick={onClose}>
          <Icons.X size={14} />
        </button>
      </div>
      <div className="git-create-label-row">
        <label>分支名称</label>
        <button type="button" onClick={() => setBranchDraft('spark/')}>
          设置前缀
        </button>
      </div>
      <input
        className="git-create-input"
        value={branchDraft}
        autoFocus
        onChange={(event) => setBranchDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void runCreateBranch()
          if (event.key === 'Escape') onClose()
        }}
      />
      {branchError && <div className="git-create-error">{branchError}</div>}
      <div className="git-create-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          关闭
        </button>
        <button
          type="button"
          className="btn"
          disabled={!branchDraft.trim() || !!branchError || busy}
          onClick={() => void runCreateBranch()}
        >
          创建并检出
        </button>
      </div>
    </GitDialogShell>
  )
}
