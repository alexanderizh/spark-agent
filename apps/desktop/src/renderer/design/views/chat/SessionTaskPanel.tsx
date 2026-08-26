import { CheckCircle2, Circle, CircleX, ListTodo, LoaderCircle } from 'lucide-react'
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
        ? '已结束'
        : '已计划'

  return (
    <section className="session-task-panel" aria-label="Agent 任务进度">
      <header className="session-task-panel-head">
        <span className="session-task-panel-title">
          <ListTodo size={15} aria-hidden="true" />
          任务
        </span>
        <span className="session-task-panel-summary">
          <span>{stateLabel}</span>
          <span aria-label={`已完成 ${completed} 项，共 ${tasks.length} 项`}>
            {completed}/{tasks.length}
          </span>
        </span>
      </header>
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
