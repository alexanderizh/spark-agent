import { CheckCircle2, CircleAlert, Clock3, LoaderCircle, ShieldAlert, XCircle } from 'lucide-react'
import type { RemoteAgentTask, RemoteAgentTaskStatus } from '@spark/protocol'
import { translate } from '../../../i18n'
import type { TranslationKey } from '../../../i18n'
import './remote-agent.less'

const STATUS_LABELS: Record<RemoteAgentTaskStatus, TranslationKey> = {
  dispatching: 'remoteAgent.status.dispatching',
  queued: 'remoteAgent.status.queued',
  running: 'remoteAgent.status.running',
  awaiting_approval: 'remoteAgent.status.awaiting_approval',
  completed: 'remoteAgent.status.completed',
  failed: 'remoteAgent.status.failed',
  rejected: 'remoteAgent.status.rejected',
  cancel_requested: 'remoteAgent.status.cancel_requested',
  cancelled: 'remoteAgent.status.cancelled',
}

function statusIcon(status: RemoteAgentTaskStatus) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={15} />
    case 'failed':
    case 'rejected':
      return status === 'failed' ? <CircleAlert size={15} /> : <ShieldAlert size={15} />
    case 'cancelled':
      return <XCircle size={15} />
    case 'dispatching':
    case 'running':
      return <LoaderCircle className="remote-agent-spin" size={15} />
    default:
      return <Clock3 size={15} />
  }
}

export function formatRemoteAgentTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export function remoteAgentTaskStatusLabel(status: RemoteAgentTaskStatus): string {
  return translate(STATUS_LABELS[status])
}

export function RemoteAgentTaskCard({
  task,
  targetName,
  onClick,
}: {
  task: RemoteAgentTask
  targetName: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`remote-agent-task-card is-${task.status}${task.transportState === 'unreachable' ? ' is-unreachable' : ''}`}
      onClick={onClick}
      aria-label={`${remoteAgentTaskStatusLabel(task.status)} · ${targetName}`}
    >
      <span className="remote-agent-task-card-status" aria-hidden="true">
        {statusIcon(task.status)}
      </span>
      <span className="remote-agent-task-card-main">
        <span className="remote-agent-task-card-heading">
          <strong>{remoteAgentTaskStatusLabel(task.status)}</strong>
          <time>{formatRemoteAgentTime(task.createdAt)}</time>
        </span>
        <span className="remote-agent-task-card-target">{targetName}</span>
        {task.transportState === 'unreachable' && (
          <span className="remote-agent-task-card-offline">
            {translate('remoteAgent.deviceOffline')}
          </span>
        )}
        {task.resultSummary != null && task.resultSummary.trim().length > 0 && (
          <span className="remote-agent-task-card-summary">{task.resultSummary}</span>
        )}
      </span>
      <span className="remote-agent-task-card-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  )
}
