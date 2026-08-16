import { Popover, Tooltip } from '@lobehub/ui'
import type {
  SessionLineage,
  SessionRuntimeWorktree,
  WorkspaceGitStatusResponse,
} from '@spark/protocol'
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icons } from '../../Icons'
import type { GoalSnapshot } from '../../services/event-mapper'
import { resolveDisplayedGitBranch } from '../chat-session-routing'
import type { BranchState } from './ChatComposerTypes'
import type { InspectorTask } from './ChatInspectorUtils'
import { formatSignedNumber, goalPhaseLabel, goalStatusLabel } from './ChatGitUtils'
import { SessionCollaborationDetails } from './SessionLineageBar'

export interface SessionCollaborationPanelData {
  lineage: SessionLineage | null
  sourceTitle?: string | null
  sourceAvailable: boolean
  childLineages: SessionLineage[]
  onOpenSource?: () => void
  onOpenChild?: (childLineage: SessionLineage) => void
}

export function GitSessionTrigger({
  open,
  isGitRepo,
  currentBranch,
  worktreeHint,
  additions,
  deletions,
  taskCount,
  taskCompletedCount,
  hasGoal,
  onToggle,
}: {
  open: boolean
  isGitRepo: boolean
  currentBranch: string | null
  /** 引擎级 worktree 提示（title 文案）；存在即视为会话运行在 worktree 中，点亮图标 */
  worktreeHint?: string | null
  additions: number
  deletions: number
  taskCount: number
  taskCompletedCount: number
  hasGoal: boolean
  onToggle: () => void
}) {
  const inWorktree = worktreeHint != null && worktreeHint !== ''
  // git 仓库优先展示分支与增删；非 git 会话退化为目标 / 进程的精简标签。
  let icon = <Icons.GitBranch size={14} />
  let label = currentBranch ?? 'Git'
  let counts: ReactNode = (
    <span className="git-session-counts">
      <span className="git-add">+{formatSignedNumber(additions)}</span>
      <span className="git-del">-{formatSignedNumber(deletions)}</span>
    </span>
  )
  if (!isGitRepo) {
    counts = null
    if (hasGoal) {
      icon = <Icons.Compass size={14} />
      label = '目标'
    } else {
      icon = <Icons.ListTodo size={14} />
      label = `进程 ${taskCompletedCount}/${taskCount}`
    }
  }

  return (
    <Tooltip title="环境信息" placement="bottom" mouseEnterDelay={0}>
      <div className="git-session-widget">
        <button
          type="button"
          className={`git-session-trigger ${open ? 'active' : ''}`}
          aria-label="环境信息"
          aria-expanded={open}
          onClick={onToggle}
        >
          {icon}
          <span
            className={`git-session-branch truncate${inWorktree ? ' is-worktree' : ''}`}
            {...(inWorktree ? { title: worktreeHint ?? undefined } : {})}
          >
            {label}
          </span>
          {counts}
        </button>
      </div>
    </Tooltip>
  )
}

export function GitEnvPanel({
  status,
  branchState,
  runtimeWorktree = null,
  onClose,
  onOpenCreateBranch,
  onOpenCommit,
  onOpenBranches,
  onOpenReview,
  onOpenTerminal,
  tasks,
  goal,
  onGoalControl,
  collaboration = null,
}: {
  status: WorkspaceGitStatusResponse | null
  branchState: BranchState
  /** 引擎级 worktree 状态（agent 上报）：存在时分支以其为准并点亮 worktree 图标 */
  runtimeWorktree?: SessionRuntimeWorktree | null
  onClose: () => void
  onOpenCreateBranch: () => void
  onOpenCommit: () => void
  onOpenBranches: () => void
  onOpenReview: () => void
  onOpenTerminal: () => void
  tasks: InspectorTask[]
  goal: GoalSnapshot | null
  onGoalControl: (action: 'pause' | 'resume' | 'clear' | 'complete' | 'confirm' | 'reject') => void
  collaboration?: SessionCollaborationPanelData | null
}) {
  const [collaborationDetailsKey, setCollaborationDetailsKey] = useState<string | null>(null)
  const isGitRepo = status?.isGitRepo === true
  const inWorktree = runtimeWorktree != null
  const worktreeHint = inWorktree
    ? `运行在隔离 worktree${runtimeWorktree.branch ? ` · ${runtimeWorktree.branch}` : ''}\n${runtimeWorktree.path}`
    : null
  const currentBranch = resolveDisplayedGitBranch({
    branchStateCurrentBranch: branchState.currentBranch,
    statusCurrentBranch: status?.currentBranch,
    runtimeWorktreeBranch: runtimeWorktree?.branch ?? null,
  })
  const additions = status?.additions ?? 0
  const deletions = status?.deletions ?? 0
  const hasCollaboration =
    collaboration != null &&
    (collaboration.lineage != null || collaboration.childLineages.length > 0)

  const collaborationKey =
    collaboration == null
      ? null
      : `${collaboration.lineage?.childSessionId ?? 'root'}:${collaboration.childLineages.length}`
  const showCollaborationDetails =
    collaborationKey != null && collaborationDetailsKey === collaborationKey

  return (
    <>
      <div className="git-env-panel" role="dialog" aria-label="环境信息">
        <div className="git-popover-header">
          <div className="git-popover-title">环境信息</div>
          <span className="git-env-spacer" />
          {isGitRepo && (
            <button
              type="button"
              className="git-popover-icon"
              title="创建并检出分支"
              onClick={onOpenCreateBranch}
            >
              <Icons.Plus size={14} />
            </button>
          )}
          <button type="button" className="git-popover-icon" title="关闭" onClick={onClose}>
            <Icons.X size={14} />
          </button>
        </div>
        {isGitRepo && (
          <>
            <button type="button" className="git-env-row strong" onClick={onOpenReview}>
              <span className="git-env-icon">
                <Icons.FilePlus size={14} />
              </span>
              <span>变更</span>
              <span className="git-env-spacer" />
              <span className="git-add">+{formatSignedNumber(additions)}</span>
              <span className="git-del">-{formatSignedNumber(deletions)}</span>
            </button>
            <button
              type="button"
              className="git-env-row"
              onClick={onOpenBranches}
              {...(inWorktree ? { title: worktreeHint ?? undefined } : {})}
            >
              <span
                className={`git-env-icon${inWorktree ? ' is-worktree' : ''}`}
                aria-hidden="true"
              >
                <Icons.GitBranch size={14} />
              </span>
              <span className="truncate">{currentBranch ?? '未检测到分支'}</span>
              {inWorktree && <span className="git-env-worktree-tag">worktree</span>}
              <Icons.ChevronDown size={13} />
            </button>
            <button type="button" className="git-env-row" onClick={onOpenCommit}>
              <span className="git-env-icon">
                <Icons.CheckCircle size={14} />
              </span>
              <span>提交或推送</span>
            </button>
          </>
        )}
        {/* 环境快捷入口：终端打开常驻，git 与否都可用 */}
        {hasCollaboration && collaboration != null && (
          <>
            <div className="git-popover-divider" />
            <button
              type="button"
              className="git-env-row session-collaboration-entry"
              aria-label="会话协作"
              onClick={() => setCollaborationDetailsKey(collaborationKey)}
            >
              <span className="git-env-icon">
                <Icons.MessageSquare size={14} />
              </span>
              <span>会话协作</span>
              <span className="git-env-spacer" />
              <span className="session-collaboration-entry-status">
                {collaboration.lineage != null
                  ? '独立会话'
                  : `${collaboration.childLineages.length} 个副本`}
              </span>
              <Icons.ChevronRight size={13} />
            </button>
          </>
        )}
        <button type="button" className="git-env-row" onClick={onOpenTerminal}>
          <span className="git-env-icon">
            <Icons.Terminal size={14} />
          </span>
          <span>打开终端</span>
        </button>
        <GitTaskProgressList tasks={tasks} />
        <GitGoalSection goal={goal} onGoalControl={onGoalControl} />
      </div>
      {showCollaborationDetails && hasCollaboration && collaboration != null ? (
        <SessionCollaborationDialog
          collaboration={collaboration}
          currentBranch={currentBranch}
          onClose={() => setCollaborationDetailsKey(null)}
        />
      ) : null}
    </>
  )
}

function SessionCollaborationDialog({
  collaboration,
  currentBranch,
  onClose,
}: {
  collaboration: SessionCollaborationPanelData
  currentBranch: string | null
  onClose: () => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="git-collaboration-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="git-collaboration-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-collaboration-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="git-collaboration-dialog-header">
          <div className="git-collaboration-dialog-heading">
            <span className="git-collaboration-dialog-icon" aria-hidden="true">
              <Icons.MessageSquare size={15} />
            </span>
            <h2 id="git-collaboration-dialog-title">会话协作</h2>
          </div>
          <button
            type="button"
            className="git-popover-icon"
            title="关闭"
            aria-label="关闭会话协作"
            onClick={onClose}
          >
            <Icons.X size={14} />
          </button>
        </header>
        <SessionCollaborationDetails
          lineage={collaboration.lineage}
          sourceAvailable={collaboration.sourceAvailable}
          childLineages={collaboration.childLineages}
          currentBranch={currentBranch}
          {...(collaboration.sourceTitle !== undefined
            ? { sourceTitle: collaboration.sourceTitle }
            : {})}
          {...(collaboration.onOpenSource != null
            ? { onOpenSource: collaboration.onOpenSource }
            : {})}
          {...(collaboration.onOpenChild != null ? { onOpenChild: collaboration.onOpenChild } : {})}
        />
      </section>
    </div>,
    document.body,
  )
}

function GitGoalSection({
  goal,
  onGoalControl,
}: {
  goal: GoalSnapshot | null
  onGoalControl: (action: 'pause' | 'resume' | 'clear' | 'complete' | 'confirm' | 'reject') => void
}) {
  if (goal == null) return null
  const statusLabel = goalStatusLabel(goal.status)
  const phaseLabel = goal.phase != null ? goalPhaseLabel(goal.phase) : null
  const iterText =
    goal.maxIterations != null ? `${goal.iteration}/${goal.maxIterations}` : `${goal.iteration}`
  const isPaused = goal.status === 'paused'
  const isActive = goal.status === 'active'
  const isPendingContract = goal.status === 'pending_contract'

  return (
    <div className="git-goal-section">
      <div className="git-popover-divider" />
      <div className="git-goal-head">
        <span className="git-goal-head-title">目标</span>
        <span className={`git-goal-status-tag ${goal.status}`}>{statusLabel}</span>
      </div>
      <div className="git-goal-objective" title={goal.objective}>
        {goal.objective}
      </div>
      <div className="git-goal-meta">
        <span className="git-goal-meta-item">
          <Icons.Layers size={11} /> 迭代 {iterText}
        </span>
        {phaseLabel != null && (
          <span className="git-goal-meta-item">
            <Icons.GitBranch size={11} /> {phaseLabel}
          </span>
        )}
      </div>
      {goal.summary && goal.summary.length > 0 && (
        <div className="git-goal-summary" title={goal.summary}>
          {goal.summary}
        </div>
      )}
      <div className="git-goal-actions">
        {isPendingContract ? (
          // 契约门控期：只提供确认/拒绝，与聊天流中的 GoalContractCard 一致。
          <>
            <button
              type="button"
              className="git-goal-action"
              onClick={() => onGoalControl('confirm')}
              title="确认验收契约并开始执行"
            >
              <Icons.Check size={12} /> 确认契约
            </button>
            <button
              type="button"
              className="git-goal-action danger"
              onClick={() => onGoalControl('reject')}
              title="拒绝契约并清除目标"
            >
              <Icons.X size={12} /> 拒绝
            </button>
          </>
        ) : (
          <>
            {isActive && (
              <button
                type="button"
                className="git-goal-action"
                onClick={() => onGoalControl('pause')}
                title="暂停目标循环"
              >
                <Icons.Pause size={12} /> 暂停
              </button>
            )}
            {isPaused && (
              <button
                type="button"
                className="git-goal-action"
                onClick={() => onGoalControl('resume')}
                title="恢复目标循环"
              >
                <Icons.Play size={12} /> 恢复
              </button>
            )}
            <button
              type="button"
              className="git-goal-action"
              onClick={() => onGoalControl('complete')}
              title="标记目标完成"
            >
              <Icons.Check size={12} /> 完成
            </button>
            <button
              type="button"
              className="git-goal-action danger"
              onClick={() => onGoalControl('clear')}
              title="清除当前目标"
            >
              <Icons.X size={12} /> 清除
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function GitTaskProgressList({ tasks }: { tasks: InspectorTask[] }) {
  const completed = tasks.filter((task) => task.status === 'completed').length
  const total = tasks.length
  const endedWithIncompleteTasks = tasks.some((task) => task.status === 'interrupted')

  if (total === 0) return null

  return (
    <div className="git-task-progress">
      <div className="git-task-progress-head">
        <span>进程</span>
        <span>
          {endedWithIncompleteTasks ? '已结束 · ' : ''}
          {completed}/{total}
        </span>
      </div>
      <div className="git-task-progress-list">
        {tasks.map((task) => (
          <GitTaskProgressItem key={task.id} task={task} />
        ))}
      </div>
    </div>
  )
}

function GitTaskProgressItem({ task }: { task: InspectorTask }) {
  const isDone = task.status === 'completed'
  const isRunning = task.status === 'in_progress'
  const isInterrupted = task.status === 'interrupted'
  const text = isRunning ? (task.activeForm ?? task.subject) : task.subject
  const popoverContent = (
    <div className="git-task-progress-popover">
      <div className="git-task-progress-popover-title">{text}</div>
      {task.description != null && task.description.trim().length > 0 && (
        <div className="git-task-progress-popover-desc">{task.description}</div>
      )}
    </div>
  )

  return (
    <Popover content={popoverContent}>
      <div
        className={`git-task-progress-item ${isDone ? 'done' : isRunning ? 'running' : 'pending'}`}
      >
        <span className="git-task-progress-icon">
          {isDone ? (
            <Icons.Check size={15} />
          ) : isRunning ? (
            <Icons.Spinner size={14} />
          ) : isInterrupted ? (
            <Icons.X size={11} />
          ) : null}
        </span>
        <span className="git-task-progress-text">{text}</span>
      </div>
    </Popover>
  )
}
