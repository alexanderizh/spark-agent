import type { ReactNode } from 'react'
import { Icons } from '../../Icons'
import { renderPlanInline } from '../../ChatInteractions'
import type { SidebarPlan } from './ChatInspectorUtils'

type MarkdownTextComponent = (props: { content: string }) => ReactNode

export function PlanSummary({
  plan,
  renderMarkdown,
}: {
  plan: SidebarPlan
  renderMarkdown: MarkdownTextComponent
}) {
  const MarkdownRenderer = renderMarkdown

  if (plan.kind === 'proposal') {
    return (
      <div className="tool-log-card">
        <div className="tool-log-section">
          <div className="tool-log-section-label">{plan.title}</div>
          <div className="tool-log-section-md md-surface">
            <MarkdownRenderer content={plan.rawPlan} />
          </div>
        </div>
      </div>
    )
  }

  const completed = plan.items.filter((item) => item.status === 'done').length
  const total = plan.items.length
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)

  return (
    <div className="inspector-plan">
      {percent > 0 ? (
        <div className="inspector-progress">
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}

      {plan.explanation && (
        <div className="inspector-plan-note md-surface">
          <MarkdownRenderer content={plan.explanation} />
        </div>
      )}
      <div className="inspector-plan-items">
        {plan.items.map((item, index) => (
          <div key={`${item.text}-${index}`} className={`inspector-plan-item ${item.status}`}>
            <span className="inspector-plan-dot-wrap">
              <span className="inspector-plan-dot">
                {item.status === 'done' && <Icons.Check size={10} />}
                {item.status === 'running' && <Icons.Spinner size={10} />}
              </span>
            </span>
            <span className="text">{renderPlanInline(item.text)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
