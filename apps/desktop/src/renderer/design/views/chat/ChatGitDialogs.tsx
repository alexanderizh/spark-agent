import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { Icons } from '../../Icons'
import { resolveDisplayedGitBranch } from '../chat-session-routing'
import type { BranchState } from './ChatComposerTypes'
import { formatSignedNumber, summarizeGitSelection } from './ChatGitUtils'
import { GitCommitScopeTree } from './GitCommitScopeTree'
import { GitBranchRows } from './BranchPicker'

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
  onPull,
  onRefresh,
}: {
  status: WorkspaceGitStatusResponse | null
  branchState: BranchState
  onClose: () => void
  onCommit: (options: {
    message: string
    includeUnstaged: boolean
    push: boolean
    paths?: string[]
  }) => Promise<void>
  onPush: () => Promise<void>
  onPull: () => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const [commitMessage, setCommitMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [busy, setBusy] = useState(false)
  // 提交范围：all = 维持原全量语义；partial = 用户圈定了文件清单
  const [scopeMode, setScopeMode] = useState<'all' | 'partial'>('all')
  const [treeOpen, setTreeOpen] = useState(false)
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(() => new Set())
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
  // 当前开关下可进入提交范围的文件清单：不包含未暂存时仅剩已暂存文件
  const committableFiles = useMemo(() => {
    const files = status?.files ?? []
    return includeUnstaged ? files : files.filter((file) => file.staged)
  }, [status, includeUnstaged])
  const selectionSummary =
    scopeMode === 'partial' ? summarizeGitSelection(committableFiles, selectedPaths) : null
  const commitFileCount =
    selectionSummary != null ? selectionSummary.count : includeUnstaged ? changedFiles : stagedFiles
  const canCommit =
    scopeMode === 'partial'
      ? (selectionSummary?.count ?? 0) > 0 && status?.isGitRepo === true
      : (includeUnstaged ? changedFiles > 0 : stagedFiles > 0) && status?.isGitRepo === true
  const canPush = status?.hasRemote === true && aheadCommits > 0
  const behindCommits = status?.behind ?? 0
  // pull 自带 fetch：behind 计数基于 remote-tracking 引用，可能过期低估为 0，
  // 因此只要配置了远端就允许随时拉取（与 VSCode 行为一致），behind 仅作徽标提示。
  const canPull = status?.hasRemote === true

  const enterPartialScope = () => {
    setScopeMode('partial')
    setTreeOpen(true)
    // 进入选择默认全选，与「默认全部提交」的基线一致
    setSelectedPaths(new Set(committableFiles.map((file) => file.path)))
  }

  const resetScopeToAll = () => {
    setScopeMode('all')
    setTreeOpen(false)
    setSelectedPaths(new Set())
  }

  const toggleIncludeUnstaged = (next: boolean) => {
    setIncludeUnstaged(next)
    if (scopeMode === 'partial') {
      // 可选范围变化：回到「全选当前清单」的默认态，避免残留越界选择
      const nextFiles = next ? (status?.files ?? []) : (status?.files ?? []).filter((f) => f.staged)
      setSelectedPaths(new Set(nextFiles.map((file) => file.path)))
    }
  }

  const runCommit = async (push: boolean) => {
    if (!canCommit || busy) return
    setBusy(true)
    try {
      await onCommit({
        // 留空时由父级 handler 决定：交给 agent 或回退模板。
        message: commitMessage.trim(),
        includeUnstaged,
        push,
        ...(scopeMode === 'partial' ? { paths: [...selectedPaths] } : {}),
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

  const runPull = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onPull()
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
          onChange={(event) => toggleIncludeUnstaged(event.target.checked)}
        />
        <span>包含未暂存的更改</span>
        <span className="git-action-count-pill">未暂存 {unstagedFiles}</span>
      </label>
      <div className="git-commit-scope-row">
        <span className="git-commit-scope-label">提交范围</span>
        {scopeMode === 'all' ? (
          <span className="git-commit-scope-chip">全部 · {commitFileCount} 个文件</span>
        ) : (
          <span
            className={`git-commit-scope-chip${(selectionSummary?.count ?? 0) === 0 ? ' is-empty' : ''}`}
          >
            已选 {selectionSummary?.count ?? 0}/{committableFiles.length}
            {(selectionSummary?.additions ?? 0) > 0 && (
              <span className="git-add">
                +{formatSignedNumber(selectionSummary?.additions ?? 0)}
              </span>
            )}
            {(selectionSummary?.deletions ?? 0) > 0 && (
              <span className="git-del">
                -{formatSignedNumber(selectionSummary?.deletions ?? 0)}
              </span>
            )}
          </span>
        )}
        {scopeMode === 'partial' && (
          <button
            type="button"
            className="git-commit-scope-reset"
            disabled={busy}
            onClick={resetScopeToAll}
          >
            重置为全部
          </button>
        )}
        <button
          type="button"
          className="git-commit-scope-toggle"
          disabled={busy || committableFiles.length === 0}
          onClick={() => (scopeMode === 'all' ? enterPartialScope() : setTreeOpen((prev) => !prev))}
        >
          {scopeMode === 'all' ? '选择文件' : treeOpen ? '收起' : '展开'}
        </button>
      </div>
      {scopeMode === 'partial' && treeOpen && (
        <GitCommitScopeTree
          files={committableFiles}
          selected={selectedPaths}
          onSelectedChange={setSelectedPaths}
          disabled={busy}
        />
      )}
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
        <button
          type="button"
          className="git-action-row"
          disabled={!canPull || busy}
          onClick={() => void runPull()}
        >
          <span className="git-env-icon">
            <Icons.Download size={14} />
          </span>
          <span>拉取</span>
          <span className="git-action-meta">
            {behindCommits > 0 && (
              <span className="git-action-count-pill">待拉取 {behindCommits}</span>
            )}
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
  onFetch,
  onCheckoutTag,
  onCreateBranchFromTag,
}: {
  status: WorkspaceGitStatusResponse | null
  branchState: BranchState
  onClose: () => void
  onSwitchBranch: (branch: string) => Promise<boolean>
  onOpenCreateBranch: () => void
  onFetch: () => Promise<void>
  onCheckoutTag?: (tag: string) => Promise<boolean>
  onCreateBranchFromTag?: (tag: string, branch: string) => Promise<boolean>
}) {
  const [branchSearch, setBranchSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [fetching, setFetching] = useState(false)
  const currentBranch = resolveDisplayedGitBranch({
    branchStateCurrentBranch: branchState.currentBranch,
    statusCurrentBranch: status?.currentBranch,
  })
  // branchState 与 status 刷新节奏不同，detached 标记取任一非空值
  const detachedHead = branchState.detachedHead ?? status?.detachedHead ?? false
  const changedFiles = status?.changedFiles ?? 0

  const runFetch = async () => {
    if (fetching) return
    setFetching(true)
    try {
      await onFetch()
    } finally {
      setFetching(false)
    }
  }

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
        <button
          type="button"
          className="git-fetch-branches-btn"
          disabled={fetching}
          onClick={() => void runFetch()}
        >
          <Icons.Refresh size={12} className={fetching ? 'is-spinning' : ''} />
          Fetch
        </button>
      </div>
      {detachedHead && currentBranch != null && currentBranch !== '' && (
        <div className="git-detached-notice">
          <Icons.AlertTriangle size={14} />
          <span>
            当前处于分离头指针（{currentBranch}
            ），新提交不归属任何分支。选择下方任意本地分支即可恢复。
          </span>
        </div>
      )}
      <div className="git-branch-list">
        <GitBranchRows
          branchState={
            branchState.branchDetails != null
              ? branchState
              : { ...branchState, branchDetails: status?.branchDetails }
          }
          search={branchSearch}
          currentBranch={currentBranch ?? ''}
          detachedHead={detachedHead}
          disabled={busy}
          currentDescription={changedFiles > 0 ? `未提交：${changedFiles} 个文件` : null}
          {...(onCheckoutTag != null &&
            onCreateBranchFromTag != null && {
              onCheckoutTag: async (tag: string) => {
                setBusy(true)
                try {
                  const ok = await onCheckoutTag(tag)
                  if (ok) onClose()
                  return ok
                } finally {
                  setBusy(false)
                }
              },
              onCreateBranchFromTag: async (tag: string, branch: string) => {
                setBusy(true)
                try {
                  const ok = await onCreateBranchFromTag(tag, branch)
                  if (ok) onClose()
                  return ok
                } finally {
                  setBusy(false)
                }
              },
            })}
          onSelect={(branch) => {
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
        />
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
