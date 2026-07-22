import { Children, Fragment, isValidElement, useState, type ReactNode } from 'react'
import { ListTree } from 'lucide-react'
import { Icons } from '../../Icons'
import './ActivitySegment.css'

type DisclosureChoice = 'auto' | 'open' | 'closed'

function countRenderableActivityItems(children: ReactNode): number {
  let count = 0
  Children.forEach(children, (child) => {
    if (child == null || typeof child === 'boolean') return
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      count += countRenderableActivityItems(child.props.children)
      return
    }
    count += 1
  })
  return count
}

export function ActivitySegment({
  summary,
  running,
  autoCollapseEnabled,
  children,
}: {
  summary: string
  running: boolean
  sealed: boolean
  autoCollapseEnabled: boolean
  children: ReactNode
}) {
  const [choice, setChoice] = useState<DisclosureChoice>('auto')
  const automaticallyOpen = !autoCollapseEnabled
  const open = choice === 'auto' ? automaticallyOpen : choice === 'open'

  if (countRenderableActivityItems(children) === 1) {
    return <div className="chat-activity-segment-single">{children}</div>
  }

  const toggle = () => {
    setChoice(open ? 'closed' : 'open')
  }

  return (
    <section
      className={`chat-activity-segment${open ? ' is-open' : ''}${running ? ' is-running' : ''}`}
      data-disclosure={choice}
    >
      <button
        type="button"
        className="chat-activity-segment-toggle"
        aria-expanded={open}
        onClick={toggle}
        title={summary}
      >
        <span className="activity-log-summary-icon chat-activity-segment-icon">
          <ListTree size={13} aria-hidden="true" />
        </span>
        <span className="chat-activity-segment-summary">{summary}</span>
        {running && (
          <span className="chat-activity-segment-live">
            <Icons.Spinner size={11} />
            进行中
          </span>
        )}
        <Icons.ChevronRight size={13} className="chat-activity-segment-chevron" />
      </button>
      {open && <div className="chat-activity-segment-body">{children}</div>}
    </section>
  )
}
