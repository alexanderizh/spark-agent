import { Popover, Tooltip } from '@lobehub/ui'
import type { WorkspaceGitStatusResponse } from '@spark/protocol'
import type { ReactNode } from 'react'
import { Icons } from '../../Icons'
import type { GoalSnapshot } from '../../services/event-mapper'
import { resolveDisplayedGitBranch } from '../chat-session-routing'
import type { BranchState } from './ChatComposerTypes'
import type { InspectorTask } from './ChatInspectorUtils'
import { formatSignedNumber, goalPhaseLabel, goalStatusLabel } from './ChatGitUtils'

export function GitSessionTrigger({
  open,
  isGitRepo,
  currentBranch,
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
  additions: number
  deletions: number
  taskCount: number
  taskCompletedCount: number
  hasGoal: boolean
  onToggle: () => void
}) {
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
          onClick={onToggle}
        >
          {icon}
          <span className="git-session-branch truncate">{label}</span>
          {counts}
        </button>
      </div>
    </Tooltip>
  )
}

export function GitEnvPanel({
  status,
  branchState,
  onClose,
  onOpenCreateBranch,
  onOpenCommit,
  onOpenBranches,
  onOpenReview,
  onOpenTerminal,
  tasks,
  goal,
  onGoalControl,
}: {
  status: WorkspaceGitStatusResponse | null
  branchState: BranchState
  onClose: () => void
  onOpenCreateBranch: () => void
  onOpenCommit: () => void
  onOpenBranches: () => void
  onOpenReview: () => void
  onOpenTerminal: () => void
  tasks: InspectorTask[]
  goal: GoalSnapshot | null
  onGoalControl: (action: 'pause' | 'resume' | 'clear' | 'complete') => void
}) {
  const isGitRepo = status?.isGitRepo === true
  const currentBranch = resolveDisplayedGitBranch({
    branchStateCurrentBranch: branchState.currentBranch,
    statusCurrentBranch: status?.currentBranch,
  })
  const additions = status?.additions ?? 0
  const deletions = status?.deletions ?? 0

  return (
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
          <button type="button" className="git-env-row" onClick={onOpenBranches}>
            <span className="git-env-icon">
              <Icons.GitBranch size={14} />
            </span>
            <span className="truncate">{currentBranch ?? '未检测到分支'}</span>
            <Icons.ChevronDown size={13} />
          </button>
          <button type="button" className="git-env-row" onClick={onOpenCommit}>
            <span className="git-env-icon">
              <Icons.CheckCircle size={14} />
            </span>
            <span>提交或推送</span>
          </button>
          {/* <div className="git-popover-divider" /> */}
          {/* <div className="git-popover-section-title">来源</div>
          <div className="git-popover-muted">{getGitSourceLabel(status)}</div> */}
        </>
      )}
      {/* 环境快捷入口：终端打开常驻，git 与否都可用 */}
      <div className="git-popover-divider" />
      <button type="button" className="git-env-row" onClick={onOpenTerminal}>
        <span className="git-env-icon">
          <Icons.Terminal size={14} />
        </span>
        <span>打开终端</span>
      </button>
      <GitTaskProgressList tasks={tasks} />
      <GitGoalSection goal={goal} onGoalControl={onGoalControl} />
    </div>
  )
}

function GitGoalSection({
  goal,
  onGoalControl,
}: {
  goal: GoalSnapshot | null
  onGoalControl: (action: 'pause' | 'resume' | 'clear' | 'complete') => void
}) {
  if (goal == null) return null
  const statusLabel = goalStatusLabel(goal.status)
  const phaseLabel = goal.phase != null ? goalPhaseLabel(goal.phase) : null
  const iterText =
    goal.maxIterations != null ? `${goal.iteration}/${goal.maxIterations}` : `${goal.iteration}`
  const isPaused = goal.status === 'paused'
  const isActive = goal.status === 'active'

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
      <div className="git-popover-divider" />
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
