import { useState, type ReactNode } from 'react'
import { ListTree } from 'lucide-react'
import { Icons } from '../../Icons'
import './ActivitySegment.css'

type DisclosureChoice = 'auto' | 'open' | 'closed'

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
