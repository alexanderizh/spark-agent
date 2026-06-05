/**
 * TeamDispatchCard — 群聊时间线中 Agent 分工的轻量状态行
 *
 * 对应事件 team_dispatch_requested（设计文档 §5.2.1）。
 * 展示：Member 收到任务、附件列表，以及收尾状态 chip（已返回 / 失败）。
 *
 * 折叠行为：运行中始终展开；终态（completed/failed/canceled）默认折叠为
 * 一行状态 chip + 成员名 + 任务前缀，点击整行展开看完整 instruction 与附件。
 */
import { useState } from 'react'
import { Icons } from '../Icons'
import { deriveTeamAvatar } from '../teamAvatar'
import type { TeamA2ATask, TeamA2AReply } from '@spark/protocol'

export interface TeamDispatchCardProps {
  task: TeamA2ATask
  /** 被调用成员的展示名（解析自 memberAgentId） */
  memberName: string
  /** dispatch 当前状态 */
  state: 'pending' | 'working' | 'completed' | 'failed' | 'canceled'
  /** 完成后的回复（用于收尾 chip：用量 / 错误） */
  reply?: TeamA2AReply
}

function formatDuration(ms?: number): string {
  if (ms == null) return ''
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function TeamDispatchCard({ task, memberName, state, reply }: TeamDispatchCardProps) {
  const memberAvatar = deriveTeamAvatar(task.memberAgentId, memberName)
  const isDone = state === 'completed'
  const isFailed = state === 'failed' || state === 'canceled'
  const isRunning = state === 'pending' || state === 'working'
  // 终态默认折叠，运行中始终展开；用户点击 head 可手动覆盖
  const [expanded, setExpanded] = useState(false)
  const showDetails = isRunning || expanded
  const collapsible = !isRunning

  const ChevronIcon = expanded ? Icons.ChevronDown : Icons.ChevronRight

  const handleHeadClick = () => {
    if (collapsible) setExpanded((prev) => !prev)
  }

  return (
    <div
      className={`team-dispatch-card${collapsible && !expanded ? ' is-collapsed' : ''}`}
      style={{ ['--member-accent' as string]: memberAvatar.color }}
    >
      <button
        type="button"
        className="team-dispatch-card-head"
        onClick={handleHeadClick}
        disabled={!collapsible}
        aria-expanded={showDetails}
      >
        <Icons.Send size={13} className="team-dispatch-card-arrow" />
        <span className="team-dispatch-card-title">
          <span className="team-dispatch-card-member">{memberName}</span>
          {collapsible && !expanded ? (
            <>
              {' · '}
              <span className="team-dispatch-card-task-preview">{task.instruction}</span>
            </>
          ) : (
            ' 收到任务'
          )}
        </span>
        {collapsible && <ChevronIcon size={12} className="team-dispatch-card-chevron" />}
      </button>

      {showDetails && (
        <>
          <div className="team-dispatch-card-task">{task.instruction}</div>

          {task.attachments != null && task.attachments.length > 0 && (
            <div className="team-dispatch-card-attachments">
              {task.attachments.map((att, idx) => (
                <span key={idx} className="team-dispatch-card-attachment" title={att.value}>
                  <Icons.File size={11} />
                  {att.type === 'text' ? '文本片段' : att.value.split('/').pop() || att.value}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <div className="team-dispatch-card-status">
        {isRunning && (
          <span className="team-dispatch-chip team-dispatch-chip-running">
            <Icons.Spinner size={12} /> 等待 {memberName} 响应…
          </span>
        )}
        {isDone && (
          <span className="team-dispatch-chip team-dispatch-chip-done">
            <Icons.CheckCircle size={12} /> 已返回
            {reply?.usage != null && (
              <span className="team-dispatch-chip-meta">
                {formatDuration(reply.usage.durationMs)}
                {reply.usage.outputTokens != null ? ` · ${reply.usage.outputTokens} tok` : ''}
              </span>
            )}
          </span>
        )}
        {isFailed && (
          <span className="team-dispatch-chip team-dispatch-chip-failed">
            <Icons.XCircle size={12} /> {state === 'canceled' ? '已取消' : '失败'}
            {reply?.error != null && <span className="team-dispatch-chip-meta">{reply.error.message}</span>}
          </span>
        )}
      </div>
    </div>
  )
}
