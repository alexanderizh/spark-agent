import { useState, type KeyboardEvent } from 'react'
import { Icons } from '../../Icons'
import type { UIBlock } from '../../services/event-mapper'
import { StreamingErrorCard } from './StreamingErrorCard'
import './RuntimeSignalCard.css'

type RuntimeSignalBlock = Extract<UIBlock, { kind: 'runtime_signal' }>

function parseBackgroundTasks(details: RuntimeSignalBlock['details']): {
  count: number
  tasks: string[]
} {
  const values = details ?? []
  const rawCount = values.find((detail) => detail.label === '运行中')?.value
  const tasks = (values.find((detail) => detail.label === '任务')?.value ?? '')
    .split(';')
    .map((task) => task.trim())
    .filter(Boolean)
  const parsedCount = Number.parseInt(rawCount ?? '', 10)
  return {
    count: Number.isFinite(parsedCount) ? Math.max(0, parsedCount) : tasks.length,
    tasks,
  }
}

function BackgroundTasksCard({ block }: { block: RuntimeSignalBlock }) {
  const [expanded, setExpanded] = useState(false)
  const { count, tasks } = parseBackgroundTasks(block.details)
  const running = count > 0
  const expandable = tasks.length > 0
  const visibleTasks = tasks.slice(0, 2)
  const remainingCount = Math.max(0, tasks.length - visibleTasks.length)
  const taskPreview = [...visibleTasks, ...(remainingCount > 0 ? [`+${remainingCount}`] : [])].join(
    ' · ',
  )
  const meta = running ? taskPreview || block.message : '所有后台任务均已结束'

  const toggle = () => {
    if (expandable) setExpanded((value) => !value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    toggle()
  }

  return (
    <section
      className={`background-tasks-card${expandable ? ' clickable' : ''}${expanded ? ' expanded' : ''}`}
    >
      <div
        className={`background-tasks-card-header${expandable ? ' clickable' : ''}`}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? expanded : undefined}
      >
        <span className="background-tasks-card-icon">
          <Icons.Activity size={14} />
        </span>
        <div className="background-tasks-card-body">
          <div className="background-tasks-card-title">
            <span>后台任务</span>
            {expandable && (
              <span className="background-tasks-card-chevron">
                {expanded ? <Icons.ChevronDown size={11} /> : <Icons.ChevronRight size={11} />}
              </span>
            )}
          </div>
          <div className="background-tasks-card-meta" title={tasks.join(' · ') || block.message}>
            {meta}
          </div>
        </div>
        <span className={`background-tasks-card-status${running ? ' running' : ' done'}`}>
          {running ? <Icons.Spinner size={11} /> : <Icons.Check size={11} />}
          {running ? `${count} 项运行中` : '已结束'}
        </span>
      </div>
      {expanded && tasks.length > 0 && (
        <div className="background-tasks-card-detail">
          {tasks.map((task, index) => (
            <div key={`${task}:${index}`} className="background-tasks-card-task">
              <span aria-hidden="true" />
              <span>{task}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function RuntimeSignalCard({
  block,
  onRetry,
}: {
  block: RuntimeSignalBlock
  onRetry?: () => void
}) {
  if (block.signal === 'background_tasks') return <BackgroundTasksCard block={block} />

  return (
    <StreamingErrorCard
      title={block.title}
      message={block.message}
      level={block.level}
      retryable={block.retryable}
      {...(block.code != null ? { code: block.code } : {})}
      {...(block.actionHint != null ? { actionHint: block.actionHint } : {})}
      {...(block.details != null ? { details: block.details } : {})}
      {...(block.origin != null ? { origin: block.origin } : {})}
      {...(block.occurrenceCount != null ? { occurrenceCount: block.occurrenceCount } : {})}
      {...(onRetry != null ? { onRetry } : {})}
    />
  )
}
