/**
 * GitPanel —— 代码面板左侧栏的 Git 管理面板主容器。
 *
 * 结构（自上而下）：标题行（Git + 刷新）· 提交区（信息输入 + 提交已暂存）
 * · 滚动区（已暂存 / 更改 / 贮藏 / 提交 四个分组）· foot（分支 + ahead/behind + 同步）。
 *
 * 数据：status 由 ChatView 共享快照受控传入（与审查面板 / 提交弹窗同源）；
 * 写操作经 useGitPanelActions 走轻量 IPC 并把响应中的最新 status 回写共享快照。
 * 丢弃更改 / 丢弃贮藏为破坏性操作，均弹 ConfirmDialog 二次确认。
 */

import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import { Icons } from '../../../Icons'
import { ConfirmDialog } from '../../ConfirmDialog'
import { GitGroupSection } from './GitChangesSection'
import { GitStashSection } from './GitStashSection'
import { GitCommitHistory } from './GitCommitHistory'
import { GitPanelFooter } from './GitPanelFooter'
import { useGitCommitLog } from './useGitCommitLog'
import { useGitPanelActions } from './useGitPanelActions'
import { setGitPanelViewMode, useGitPanelViewMode } from './gitPanelVisibility'
import {
  buildGitPanelFileLabels,
  buildGitPanelLogRefreshKey,
  splitPendingGitChanges,
} from './gitPanelViewUtils'
import './git-panel.less'

type ConfirmState =
  | { kind: 'discard'; paths: string[]; label: string }
  | { kind: 'drop-stash'; selector: string; label: string }
  | null

export interface GitPanelProps {
  workspaceId: string | null
  status: WorkspaceGitStatusResponse | null
  /** 手动刷新共享 git 快照（refreshGitStatus） */
  onRefresh: () => void
  /** 写操作后回写共享快照（applyGitStatus） */
  onStatusApplied: (status: WorkspaceGitStatusResponse | null) => void
  /** 在编辑器中打开文件（相对路径，自动切 diff 视图） */
  onOpenFile: (relativePath: string) => void
}

export function GitPanel({
  workspaceId,
  status,
  onRefresh,
  onStatusApplied,
  onOpenFile,
}: GitPanelProps) {
  const [commitMessage, setCommitMessage] = useState('')
  const [stagedCollapsed, setStagedCollapsed] = useState(false)
  const [changesCollapsed, setChangesCollapsed] = useState(false)
  const [stashCollapsed, setStashCollapsed] = useState(true)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [logTick, setLogTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const viewMode = useGitPanelViewMode()

  // 手动刷新指示：共享 status 快照一旦更新（轮询回包 / 写操作回写）即结束
  useEffect(() => {
    setRefreshing(false)
  }, [status])

  /** 首次进入：共享快照还没回来（status 为 null）时显示骨架，不渲染空面板 */
  const loadingStatus = workspaceId != null && status == null

  const actions = useGitPanelActions({ workspaceId, onStatusApplied })
  const logRefreshKey = useMemo(
    () => buildGitPanelLogRefreshKey(status, logTick),
    [status, logTick],
  )
  const log = useGitCommitLog(workspaceId, logRefreshKey)

  const statusFiles = status?.files
  const { staged, unstaged } = useMemo(
    () => splitPendingGitChanges(statusFiles ?? []),
    [statusFiles],
  )
  const labels = useMemo(
    () => buildGitPanelFileLabels([...staged, ...unstaged].map((f) => f.path)),
    [staged, unstaged],
  )
  const stashEntries = status?.stashEntries ?? []

  const canCommit = commitMessage.trim().length > 0 && staged.length > 0 && actions.busy == null

  const submitCommit = async (): Promise<void> => {
    if (!canCommit) return
    const ok = await actions.commitStaged(commitMessage.trim())
    if (ok) setCommitMessage('')
  }

  const handleCommitKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void submitCommit()
    }
  }

  const handleRefresh = (): void => {
    onRefresh()
    setLogTick((t) => t + 1)
    setRefreshing(true)
  }

  const handleConfirmOk = async (): Promise<void> => {
    const current = confirm
    setConfirm(null)
    if (current == null) return
    if (current.kind === 'discard') await actions.discard(current.paths)
    else await actions.stashDrop(current.selector)
  }

  const headerSpinner = refreshing || loadingStatus

  const renderHeader = (
    <div className="gp-header">
      <span className="gp-header-title">
        <Icons.GitBranch size={13} className="gp-header-icon" />
        Git
      </span>
      <span className="gp-header-actions">
        <button
          type="button"
          className="gp-icon-btn"
          title={viewMode === 'list' ? '切换为树形目录显示' : '切换为平铺列表显示'}
          onClick={() => setGitPanelViewMode(viewMode === 'list' ? 'tree' : 'list')}
        >
          {viewMode === 'list' ? <Icons.FolderClosed size={14} /> : <Icons.ListTodo size={14} />}
        </button>
        <button type="button" className="gp-icon-btn" title="刷新" onClick={handleRefresh}>
          {headerSpinner ? (
            <Icons.Spinner size={13} className="gp-spin" />
          ) : (
            <Icons.RotateCw size={13} />
          )}
        </button>
      </span>
    </div>
  )

  if (status != null && status.isGitRepo !== true) {
    return (
      <div className="gp-panel">
        {renderHeader}
        <div className="gp-state">当前项目不是 Git 仓库</div>
      </div>
    )
  }

  if (loadingStatus) {
    return (
      <div className="gp-panel">
        {renderHeader}
        <div className="gp-loading" aria-label="正在加载 Git 状态">
          <div className="gp-skeleton" style={{ width: '86%' }} />
          <div className="gp-skeleton" style={{ width: '64%' }} />
          <div className="gp-skeleton" style={{ width: '78%' }} />
          <div className="gp-skeleton" style={{ width: '52%' }} />
          <div className="gp-skeleton" style={{ width: '70%' }} />
        </div>
        <GitPanelFooter status={null} busy={false} onSync={() => {}} />
      </div>
    )
  }

  return (
    <div className="gp-panel">
      {renderHeader}

      <div className="gp-commit-box">
        <textarea
          className="gp-commit-input"
          rows={2}
          value={commitMessage}
          placeholder={
            staged.length > 0
              ? `提交信息（⌘S 提交已暂存的 ${staged.length} 个文件）`
              : '提交信息（先暂存要提交的文件）'
          }
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={handleCommitKeyDown}
        />
        <div className="gp-commit-actions">
          <button
            type="button"
            className="gp-commit-btn"
            disabled={!canCommit}
            title={staged.length === 0 ? '没有已暂存的文件' : '提交当前已暂存的更改（⌘S）'}
            onClick={() => void submitCommit()}
          >
            {actions.busy === 'commit' ? (
              <Icons.Spinner size={13} className="gp-spin" />
            ) : (
              <Icons.Check size={13} />
            )}
            提交{staged.length > 0 ? ` (${staged.length})` : ''}
          </button>
        </div>
      </div>

      <div className="gp-scroll">
        <GitGroupSection
          title="已暂存"
          group="staged"
          files={staged}
          labels={labels}
          viewMode={viewMode}
          collapsed={stagedCollapsed}
          busy={actions.busy}
          onToggle={() => setStagedCollapsed((v) => !v)}
          onStage={actions.stage}
          onUnstage={actions.unstage}
          onOpenFile={onOpenFile}
          onDiscardRequest={(paths, label) => setConfirm({ kind: 'discard', paths, label })}
        />
        <GitGroupSection
          title="更改"
          group="changes"
          files={unstaged}
          labels={labels}
          viewMode={viewMode}
          collapsed={changesCollapsed}
          busy={actions.busy}
          onToggle={() => setChangesCollapsed((v) => !v)}
          onStage={actions.stage}
          onUnstage={actions.unstage}
          onOpenFile={onOpenFile}
          onStash={() => void actions.stash()}
          onDiscardRequest={(paths, label) => setConfirm({ kind: 'discard', paths, label })}
        />
        <GitStashSection
          entries={stashEntries}
          collapsed={stashCollapsed}
          busy={actions.busy != null}
          onToggle={() => setStashCollapsed((v) => !v)}
          onPop={(selector) => void actions.stashPop(selector)}
          onDropRequest={(selector, label) => setConfirm({ kind: 'drop-stash', selector, label })}
        />
        <GitCommitHistory
          commits={log.commits}
          loading={log.loading}
          error={log.error}
          collapsed={historyCollapsed}
          onToggle={() => setHistoryCollapsed((v) => !v)}
          onRefresh={() => setLogTick((t) => t + 1)}
        />
      </div>

      <GitPanelFooter
        status={status}
        busy={actions.busy === 'sync' || actions.busy === 'pull' || actions.busy === 'push'}
        onSync={() => void actions.sync()}
      />

      <ConfirmDialog
        open={confirm != null}
        title={confirm?.kind === 'drop-stash' ? '丢弃贮藏' : '丢弃更改'}
        danger
        confirmText="丢弃"
        description={
          confirm == null
            ? undefined
            : confirm.kind === 'drop-stash'
              ? `确定丢弃贮藏「${confirm.label}」？丢弃后不可恢复。`
              : confirm.paths.length > 1
                ? `确定丢弃 ${confirm.paths.length} 个文件的更改？未提交的修改将被永久删除，不可恢复。`
                : `确定丢弃「${confirm.label}」的更改？未提交的修改将被永久删除，不可恢复。`
        }
        onOpenChange={(o) => {
          if (!o) setConfirm(null)
        }}
        onConfirm={handleConfirmOk}
      />
    </div>
  )
}
