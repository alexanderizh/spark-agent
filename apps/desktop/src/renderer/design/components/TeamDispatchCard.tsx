import { useEffect, useState } from 'react'
import type { TeamA2ATask, TeamA2AReply } from '@spark/protocol'
import { Icons } from '../Icons'
import { deriveTeamAvatar } from '../teamAvatar'
import { AvatarImage } from './AvatarImage'
import { Button, Tag } from 'antd'

export interface TeamDispatchCardProps {
  task: TeamA2ATask
  memberName: string
  avatarSrc?: string
  state: 'pending' | 'working' | 'completed' | 'failed' | 'canceled'
  reply?: TeamA2AReply
}

export function TeamDispatchCard({
  task,
  memberName,
  avatarSrc = '',
  state,
}: TeamDispatchCardProps) {
  const memberAvatar = deriveTeamAvatar(task.memberAgentId, memberName)
  const isDone = state === 'completed'
  const isFailed = state === 'failed' || state === 'canceled'
  const isRunning = state === 'pending' || state === 'working'
  const [expanded, setExpanded] = useState(false)
  const showDetails = isRunning || expanded
  const collapsible = !isRunning
  const ChevronIcon = expanded ? Icons.ChevronDown : Icons.ChevronRight

  useEffect(() => {
    if (!isRunning) setExpanded(false)
  }, [isRunning, state])

  const handleHeadClick = () => {
    if (collapsible) setExpanded((prev) => !prev)
  }

  return (
    <div
      className={`team-dispatch-card${collapsible && !expanded ? ' is-collapsed' : ''}`}
      style={{ ['--member-accent' as string]: memberAvatar.color }}
    >
      <Button
        type="text"
        className="team-dispatch-card-head"
        onClick={handleHeadClick}
        disabled={!collapsible}
        aria-expanded={showDetails}
        title={`${memberName} 收到任务`}
      >
        <span className="team-dispatch-card-avatar" aria-hidden="true">
          <AvatarImage src={avatarSrc} seed={task.memberAgentId} name={memberName} alt="" />
        </span>
        <span className="team-dispatch-card-title">
          <span className="team-dispatch-card-member">{memberName}</span>
          <span className="team-dispatch-card-action">收到任务</span>
          {isDone && (
            <Icons.CheckCircle
              size={13}
              className="team-dispatch-card-result team-dispatch-card-result-done"
              aria-label="已返回"
            />
          )}
          {isFailed && (
            <Icons.XCircle
              size={13}
              className="team-dispatch-card-result team-dispatch-card-result-failed"
              aria-label={state === 'canceled' ? '已取消' : '失败'}
            />
          )}
          {collapsible && !expanded && (
            <span className="team-dispatch-card-task-preview">{task.instruction}</span>
          )}
        </span>
        {collapsible && <ChevronIcon size={12} className="team-dispatch-card-chevron" />}
      </Button>

      {showDetails && (
        <div className="team-dispatch-task-panel">
          <div className="team-dispatch-task-panel-head">
            <span className="team-dispatch-task-panel-dot" />
            <span>任务详情</span>
          </div>
          <div className="team-dispatch-card-task">{task.instruction}</div>

          {task.attachments != null && task.attachments.length > 0 && (
            <div className="team-dispatch-card-attachments">
              {task.attachments.map((att, idx) => (
                <Tag key={idx} className="team-dispatch-card-attachment" title={att.value}>
                  <Icons.File size={11} />
                  {att.type === 'text' ? '文本片段' : att.value.split('/').pop() || att.value}
                </Tag>
              ))}
            </div>
          )}
        </div>
      )}

      {isRunning && (
        <div className="team-dispatch-card-status">
          <span className="team-dispatch-chip team-dispatch-chip-running">
            <Icons.Spinner size={12} /> 等待 {memberName} 响应...
          </span>
        </div>
      )}
    </div>
  )
}
