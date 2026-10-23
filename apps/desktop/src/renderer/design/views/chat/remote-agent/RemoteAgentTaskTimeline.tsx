import { useRemoteAgentSession } from './RemoteAgentSession'
import { RemoteAgentTaskCard } from './RemoteAgentTaskCard'
import { translate, useI18n } from '../../../i18n'
import './remote-agent.less'

export function RemoteAgentTaskTimeline() {
  useI18n()
  const { tasks, devices, selectTask } = useRemoteAgentSession()
  if (tasks.length === 0) return null

  const onlineDevices = new Map(devices.map((device) => [device.deviceId, device.name]))

  return (
    <section className="remote-agent-timeline" aria-label={translate('remoteAgent.timelineTitle')}>
      <header className="remote-agent-timeline-heading">
        <span>{translate('remoteAgent.timelineTitle')}</span>
        <span>{tasks.length}</span>
      </header>
      <div className="remote-agent-timeline-list">
        {tasks.map((task) => (
          <RemoteAgentTaskCard
            key={task.taskId}
            task={task}
            targetName={
              onlineDevices.get(task.targetDeviceId) ??
              `${translate('remoteAgent.unknownDevice')} ${task.targetDeviceId.slice(0, 8)}`
            }
            onClick={() => selectTask(task.taskId)}
          />
        ))}
      </div>
    </section>
  )
}
