import { useId, useState, type ReactNode } from 'react'
import { Icons } from '../Icons'
import './InspectorCollapsibleSection.less'

interface InspectorCollapsibleSectionProps {
  title: ReactNode
  summary?: ReactNode
  headerAction?: ReactNode
  children: ReactNode
  className?: string
}

export function InspectorCollapsibleSection({
  title,
  summary,
  headerAction,
  children,
  className,
}: InspectorCollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(true)
  const contentId = useId()

  return (
    <section
      className={`inspector-section inspector-collapsible-section${className ? ` ${className}` : ''}`}
    >
      <h4 className={`inspector-collapsible-section__header${collapsed ? '' : ' is-expanded'}`}>
        <button
          type="button"
          className="inspector-collapsible-section__toggle"
          aria-controls={contentId}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? '展开' : '折叠'}
        >
          <span className="inspector-collapsible-section__title">{title}</span>
          {summary}
          <Icons.ChevronRight
            aria-hidden="true"
            size={10}
            className={`chev${collapsed ? '' : ' chev-open'}`}
          />
        </button>
        {headerAction != null && (
          <span className="inspector-collapsible-section__action">{headerAction}</span>
        )}
      </h4>
      <div id={contentId} className="inspector-collapsible-section__content" hidden={collapsed}>
        {!collapsed && children}
      </div>
    </section>
  )
}
