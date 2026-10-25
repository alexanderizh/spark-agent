import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Spin } from 'antd'
import type { RemoteAgentTask, RemoteAgentTaskEvent } from '@spark/protocol'
import { useIpcInvoke } from '../../../hooks/useIpc'
import { useToast } from '../../../components/Toast'
import { translate, useI18n } from '../../../i18n'
import { useRemoteAgentSession } from './RemoteAgentSession'
import { formatRemoteAgentTime, remoteAgentTaskStatusLabel } from './RemoteAgentTaskCard'
import './remote-agent.less'

interface ActivityRow {
  id: string
  label: string
  content: string | null
  timestamp: string
}

function describeEvent(event: RemoteAgentTaskEvent): ActivityRow | null {
  switch (event.type) {
    case 'user_message':
      return {
        id: event.id,
        label: translate('remoteAgent.activityUser'),
        content: event.content ?? '',
        timestamp: event.timestamp,
      }
    case 'assistant_message':
      return {
        id: event.id,
        label: translate('remoteAgent.activityAgent'),
        content: event.content ?? '',
        timestamp: event.timestamp,
      }
    case 'tool_call':
      return {
        id: event.id,
        label: translate('remoteAgent.activityToolCall'),
        content: event.toolName ?? null,
        timestamp: event.timestamp,
      }
    case 'tool_result':
      return {
        id: event.id,
        label: translate(
          event.toolStatus === 'error'
            ? 'remoteAgent.activityToolFailed'
            : 'remoteAgent.activityToolCompleted',
        ),
        content: event.toolName ?? null,
        timestamp: event.timestamp,
      }
    case 'agent_status':
      return {
        id: event.id,
        label: translate('remoteAgent.activityStatus'),
        content: event.statusMessage ?? event.status ?? null,
        timestamp: event.timestamp,
      }
    case 'agent_error':
      return {
        id: event.id,
        label: translate('remoteAgent.status.failed'),
        content: event.content ?? null,
        timestamp: event.timestamp,
      }
    case 'presented_files':
      return {
        id: event.id,
        label: translate('remoteAgent.artifacts'),
        content: null,
        timestamp: event.timestamp,
      }
    case 'agent_thinking':
      return null
  }
}

export function RemoteAgentTaskDetails({
  task,
  targetName,
  onBack,
}: {
  task: RemoteAgentTask
  targetName: string
  onBack: () => void
}) {
  useI18n()
  const { refreshTasks, taskEventsRevision, devices } = useRemoteAgentSession()
  const { toast } = useToast()
  const [events, setEvents] = useState<RemoteAgentTaskEvent[]>([])
  const [artifacts, setArtifacts] = useState<
    Array<{ artifactId: string; name: string; title?: string; kind: 'attachment' | 'presented' }>
  >([])
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [targetProjectName, setTargetProjectName] = useState<string | null>(null)
  const [targetAgentName, setTargetAgentName] = useState<string | null>(null)

  const { invoke: getHistory } = useIpcInvoke('remote-agent:task:get-history')
  const { invoke: listArtifacts } = useIpcInvoke('remote-agent:task:list-artifacts')
  const { invoke: approve } = useIpcInvoke('remote-agent:task:approve')
  const { invoke: cancelTask } = useIpcInvoke('remote-agent:task:cancel')
  const { invoke: reconcile } = useIpcInvoke('remote-agent:task:reconcile')
  const { invoke: fetchArtifact } = useIpcInvoke('remote-agent:task:fetch-artifact')
  const { invoke: openFile } = useIpcInvoke('file:open')
  const { invoke: listProjects } = useIpcInvoke('remote-agent:target:list-projects')
  const { invoke: listAgents } = useIpcInvoke('remote-agent:target:list-agents')

  useEffect(() => {
    const targetOnline = devices.some(
      (device) => device.deviceId === task.targetDeviceId && device.online,
    )
    if (!targetOnline) {
      setTargetProjectName(null)
      setTargetAgentName(null)
      return
    }
    let current = true
    void listProjects({ deviceId: task.targetDeviceId })
      .then(async ({ projects }) => {
        const project = projects.find((item) => item.id === task.targetProjectId)
        if (current) setTargetProjectName(project?.name ?? null)
        if (project == null) return
        const response = await listAgents({
          deviceId: task.targetDeviceId,
          projectId: task.targetProjectId,
        })
        const agent = response.agents.find((item) => item.id === task.targetAgentId)
        if (current) setTargetAgentName(agent?.name ?? null)
      })
      .catch(() => {
        if (current) {
          setTargetProjectName(null)
          setTargetAgentName(null)
        }
      })
    return () => {
      current = false
    }
  }, [
    devices,
    listAgents,
    listProjects,
    task.targetAgentId,
    task.targetDeviceId,
    task.targetProjectId,
  ])

  useEffect(() => {
    let current = true
    setLoading(true)
    setError(null)
    void Promise.all([getHistory({ taskId: task.taskId }), listArtifacts({ taskId: task.taskId })])
      .then(([history, artifactList]) => {
        if (!current) return
        setEvents(history.events)
        setArtifacts(artifactList.artifacts)
      })
      .catch((reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [getHistory, listArtifacts, task.taskId, taskEventsRevision, task.updatedAt])

  const activity = useMemo(
    () => events.map(describeEvent).filter((row): row is ActivityRow => row != null),
    [events],
  )

  let failureReason: string | null = null
  if (task.status === 'failed') {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event: RemoteAgentTaskEvent | undefined = events[index]
      if (event == null) continue
      if (event.type === 'agent_error' && event.content?.trim()) {
        failureReason = event.content.trim()
        break
      }
      if (
        event.type === 'agent_status' &&
        event.status === 'error' &&
        event.statusMessage?.trim()
      ) {
        failureReason = event.statusMessage.trim()
        break
      }
    }
  }

  const runAction = async (name: string, action: () => Promise<unknown>) => {
    if (busyAction != null) return
    setBusyAction(name)
    setError(null)
    try {
      await action()
      await refreshTasks()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      toast.error(message)
    } finally {
      setBusyAction(null)
    }
  }

  const handleArtifact = async (artifactId: string) => {
    await runAction(artifactId, async () => {
      const file = await fetchArtifact({ taskId: task.taskId, artifactId })
      const result = await openFile({ filePath: file.localPath })
      if (!result.opened) throw new Error(result.error ?? translate('remoteAgent.openFailed'))
    })
  }

  const targetIsActive =
    task.status === 'dispatching' ||
    task.status === 'queued' ||
    task.status === 'running' ||
    task.status === 'awaiting_approval'

  return (
    <div className="remote-agent-details">
      <div className="remote-agent-details-topline">
        <Button type="text" size="small" onClick={onBack}>
          ‹ {translate('remoteAgent.back')}
        </Button>
        <span className={`remote-agent-status-pill is-${task.status}`}>
          {remoteAgentTaskStatusLabel(task.status)}
        </span>
      </div>

      <div className="remote-agent-details-summary">
        <div className="remote-agent-details-target">{targetName}</div>
        <div>{formatRemoteAgentTime(task.createdAt)}</div>
        <div className="remote-agent-location">
          <strong>{translate('remoteAgent.location')}:</strong>{' '}
          {targetProjectName ?? task.targetProjectId} · {targetAgentName ?? task.targetAgentId}
        </div>
        {task.transportState === 'unreachable' && (
          <p className="remote-agent-offline-note">{translate('remoteAgent.deviceOffline')}</p>
        )}
        {task.errorCode === 'REMOTE_DISPATCH_INTERRUPTED' && (
          <p className="remote-agent-inline-note">{translate('remoteAgent.dispatchInterrupted')}</p>
        )}
        {failureReason != null && (
          <section className="remote-agent-failure-reason">
            <h3>{translate('remoteAgent.failureReason')}</h3>
            <p>{failureReason}</p>
          </section>
        )}
        {task.resultSummary != null && task.resultSummary.trim().length > 0 && (
          <section>
            <h3>{translate('remoteAgent.result')}</h3>
            <p className="remote-agent-result-text">{task.resultSummary}</p>
          </section>
        )}
      </div>

      {task.status === 'awaiting_approval' && task.pendingApprovalId != null && (
        <section className="remote-agent-approval" aria-live="polite">
          <strong>{translate('remoteAgent.approvalRequired')}</strong>
          <div className="remote-agent-action-row">
            <Button
              type="primary"
              loading={busyAction === 'approve'}
              disabled={busyAction != null}
              onClick={() =>
                void runAction('approve', () =>
                  approve({
                    taskId: task.taskId,
                    approvalId: task.pendingApprovalId!,
                    decision: 'allow-once',
                  }),
                )
              }
            >
              {translate('remoteAgent.approveOnce')}
            </Button>
            <Button
              danger
              loading={busyAction === 'deny'}
              disabled={busyAction != null}
              onClick={() =>
                void runAction('deny', () =>
                  approve({
                    taskId: task.taskId,
                    approvalId: task.pendingApprovalId!,
                    decision: 'deny',
                  }),
                )
              }
            >
              {translate('remoteAgent.deny')}
            </Button>
          </div>
        </section>
      )}

      {task.status === 'cancel_requested' && (
        <p className="remote-agent-inline-note">{translate('remoteAgent.cancelRequested')}</p>
      )}

      <div className="remote-agent-action-row">
        <Button
          size="small"
          loading={busyAction === 'reconcile'}
          disabled={busyAction != null}
          onClick={() => void runAction('reconcile', () => reconcile({ taskId: task.taskId }))}
        >
          {translate('remoteAgent.retrySync')}
        </Button>
        {targetIsActive && task.status !== 'cancel_requested' && (
          <Button
            size="small"
            danger
            loading={busyAction === 'cancel'}
            disabled={busyAction != null}
            onClick={() => void runAction('cancel', () => cancelTask({ taskId: task.taskId }))}
          >
            {translate('remoteAgent.cancelTask')}
          </Button>
        )}
      </div>

      {error != null && (
        <div className="remote-agent-error" role="alert">
          {error}
        </div>
      )}

      {artifacts.length > 0 && (
        <section className="remote-agent-details-section">
          <h3>{translate('remoteAgent.artifacts')}</h3>
          <ul className="remote-agent-artifact-list">
            {artifacts.map((artifact) => (
              <li key={artifact.artifactId}>
                <span title={artifact.title}>{artifact.title ?? artifact.name}</span>
                <Button
                  size="small"
                  type="link"
                  loading={busyAction === artifact.artifactId}
                  disabled={busyAction != null}
                  onClick={() => void handleArtifact(artifact.artifactId)}
                >
                  {translate('remoteAgent.fetchArtifact')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="remote-agent-details-section">
        <h3>{translate('remoteAgent.activity')}</h3>
        {loading ? (
          <div className="remote-agent-loading">
            <Spin size="small" />
          </div>
        ) : activity.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={translate('remoteAgent.noActivity')}
          />
        ) : (
          <ol className="remote-agent-activity-list">
            {activity.map((row) => (
              <li key={row.id}>
                <div className="remote-agent-activity-meta">
                  <strong>{row.label}</strong>
                  <time>{formatRemoteAgentTime(row.timestamp)}</time>
                </div>
                {row.content != null && row.content.trim().length > 0 && <p>{row.content}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
