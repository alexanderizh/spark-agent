import { CheckCircle2, Circle, CircleX, LoaderCircle } from 'lucide-react'
import { BlockTrafficHeader } from '../../components/BlockTrafficHeader'
import type { InspectorTask } from './ChatInspectorUtils'
import './SessionTaskPanel.less'

export function SessionTaskPanel({ tasks }: { tasks: InspectorTask[] }) {
  if (tasks.length === 0) return null

  const completed = tasks.filter((task) => task.status === 'completed').length
  const hasRunning = tasks.some((task) => task.status === 'in_progress')
  const hasInterrupted = tasks.some((task) => task.status === 'interrupted')
  const stateLabel = hasRunning
    ? '进行中'
    : completed === tasks.length
      ? '已完成'
      : hasInterrupted
        ? '已中断'
        : '已计划'

  return (
    <section className="session-task-panel" aria-label="Agent 任务进度">
      <BlockTrafficHeader
        title="任务"
        status={stateLabel}
        actions={
          <span
            className="session-task-panel-summary"
            aria-label={`已完成 ${completed} 项，共 ${tasks.length} 项`}
          >
            {completed}/{tasks.length}
          </span>
        }
      />
      <ol className="session-task-panel-list">
        {tasks.map((task) => {
          const isRunning = task.status === 'in_progress'
          const label = isRunning ? (task.activeForm ?? task.subject) : task.subject
          const description = task.description?.trim()

          return (
            <li
              key={`${task.id}:${task.createdAt}`}
              className={`session-task-panel-item is-${task.status}`}
              aria-current={isRunning ? 'step' : undefined}
              title={description == null ? task.subject : `${task.subject}\n${description}`}
            >
              <span className="session-task-panel-status" aria-hidden="true">
                {task.status === 'completed' ? (
                  <CheckCircle2 size={15} />
                ) : isRunning ? (
                  <LoaderCircle className="session-task-panel-spinner" size={15} />
                ) : task.status === 'interrupted' ? (
                  <CircleX size={15} />
                ) : (
                  <Circle size={15} />
                )}
              </span>
              <span className="session-task-panel-copy">
                <span className="session-task-panel-text">{label}</span>
                {description != null && description.length > 0 && (
                  <span className="session-task-panel-description">{description}</span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
