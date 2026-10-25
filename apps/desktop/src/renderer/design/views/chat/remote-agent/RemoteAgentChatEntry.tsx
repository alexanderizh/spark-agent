import { useEffect, useMemo, useState } from 'react'
import { Button, Drawer, Empty, Spin } from 'antd'
import { UsersRound } from 'lucide-react'
import { Icons } from '../../../Icons'
import type { UIMessage } from '../../../services/event-mapper'
import { translate, useI18n } from '../../../i18n'
import { RemoteAgentDispatchModal } from './RemoteAgentDispatchModal'
import { RemoteAgentTaskCard } from './RemoteAgentTaskCard'
import { RemoteAgentTaskDetails } from './RemoteAgentTaskDetails'
import { useRemoteAgentSession } from './RemoteAgentSession'
import { RemoteAgentSessionProvider } from './RemoteAgentSession'
import './remote-agent.less'

export function RemoteAgentChatEntry({ messages }: { messages: UIMessage[] }) {
  useI18n()
  const {
    tasks,
    devices,
    relayStatus,
    taskError,
    relayError,
    drawerOpen,
    selectedTaskId,
    refreshTasks,
    refreshRelay,
    setDrawerOpen,
    selectTask,
  } = useRemoteAgentSession()
  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const activeTaskCount = tasks.filter(
    (task) =>
      task.status === 'dispatching' ||
      task.status === 'queued' ||
      task.status === 'running' ||
      task.status === 'awaiting_approval' ||
      task.status === 'cancel_requested',
  ).length
  const onlineDeviceNames = useMemo(
    () => new Map(devices.map((device) => [device.deviceId, device.name])),
    [devices],
  )
  const selectedTask = tasks.find((task) => task.taskId === selectedTaskId) ?? null

  useEffect(() => {
    if (!drawerOpen) return
    void refreshTasks()
    void refreshRelay(true)
  }, [drawerOpen, refreshRelay, refreshTasks])

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    await Promise.all([refreshTasks(), refreshRelay(true)])
    setRefreshing(false)
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    selectTask(null)
  }

  return (
    <>
      <div className="inspector-section">
        <h4 className="config-panel-header">
          <button
            type="button"
            className="session-panel-toggle remote-agent-panel-toggle"
            aria-label={translate('remoteAgent.title')}
            title={translate('remoteAgent.title')}
            onClick={() => setDrawerOpen(true)}
          >
            <UsersRound size={11} strokeWidth={1.7} />
            {translate('remoteAgent.entry')}
            <span className="spacer" />
            {activeTaskCount > 0 && (
              <span className="remote-agent-entry-count">{activeTaskCount}</span>
            )}
            <Icons.ChevronRight size={10} className="chev" />
          </button>
        </h4>
      </div>

      <Drawer
        className="remote-agent-drawer"
        title={
          selectedTask == null ? translate('remoteAgent.title') : translate('remoteAgent.details')
        }
        placement="right"
        width={520}
        open={drawerOpen}
        onClose={closeDrawer}
        extra={
          <Button
            size="small"
            type="text"
            loading={refreshing}
            onClick={() => void handleRefresh()}
          >
            {translate('remoteAgent.refresh')}
          </Button>
        }
      >
        {selectedTask != null ? (
          <RemoteAgentTaskDetails
            key={selectedTask.taskId}
            task={selectedTask}
            targetName={
              onlineDeviceNames.get(selectedTask.targetDeviceId) ??
              `${translate('remoteAgent.unknownDevice')} ${selectedTask.targetDeviceId.slice(0, 8)}`
            }
            onBack={() => selectTask(null)}
          />
        ) : (
          <div className="remote-agent-drawer-content">
            <div
              className={`remote-agent-relay-state${relayStatus.connected ? ' is-connected' : ''}`}
            >
              <span className="remote-agent-relay-dot" aria-hidden="true" />
              <span>
                {relayStatus.connected
                  ? translate('remoteAgent.connected')
                  : relayStatus.state === 'connecting' || relayStatus.state === 'reconnecting'
                    ? translate('remoteAgent.connecting')
                    : translate('remoteAgent.disconnected')}
              </span>
            </div>
            {(relayError ?? relayStatus.lastError) != null && (
              <div className="remote-agent-inline-note" role="status">
                {relayError ?? relayStatus.lastError}
              </div>
            )}

            <Button
              type="primary"
              block
              icon={<UsersRound size={15} />}
              onClick={() => setDispatchOpen(true)}
            >
              {translate('remoteAgent.dispatch')}
            </Button>

            <section className="remote-agent-drawer-tasks">
              <h3>{translate('remoteAgent.tasks')}</h3>
              {taskError != null ? (
                <div className="remote-agent-error" role="alert">
                  {taskError}
                </div>
              ) : tasks.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={translate('remoteAgent.empty')}
                />
              ) : (
                <div className="remote-agent-drawer-task-list">
                  {tasks.map((task) => (
                    <RemoteAgentTaskCard
                      key={task.taskId}
                      task={task}
                      targetName={
                        onlineDeviceNames.get(task.targetDeviceId) ??
                        `${translate('remoteAgent.unknownDevice')} ${task.targetDeviceId.slice(0, 8)}`
                      }
                      onClick={() => selectTask(task.taskId)}
                    />
                  ))}
                </div>
              )}
              {refreshing && tasks.length === 0 && (
                <div className="remote-agent-loading">
                  <Spin size="small" />
                </div>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <RemoteAgentDispatchModal
        open={dispatchOpen}
        messages={messages}
        onClose={() => setDispatchOpen(false)}
        onDispatched={(task) => {
          setDispatchOpen(false)
          setDrawerOpen(true)
          selectTask(task.taskId)
          void refreshTasks()
        }}
      />
    </>
  )
}

/** The config panel renders outside the active-session provider subtree, so the entry carries its own provider. */
export function RemoteAgentSessionEntry({
  sessionId,
  messages,
}: {
  sessionId: string
  messages: UIMessage[]
}) {
  return (
    <RemoteAgentSessionProvider sessionId={sessionId}>
      <RemoteAgentChatEntry messages={messages} />
    </RemoteAgentSessionProvider>
  )
}
