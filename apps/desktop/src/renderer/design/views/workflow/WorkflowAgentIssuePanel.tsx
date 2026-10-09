import { Icons } from '../../Icons'
import type { AgentBindingIssue } from './agent-binding-validation'

/**
 * 执行者绑定校验面板：展示 agent 节点的绑定问题（错误=阻断保存、提醒=回退兜底）。
 * 条目可点击定位到画布节点（节点在当前编辑视口内时）；位于循环体内的条目仅提示不可直接定位。
 */
export function WorkflowAgentIssuePanel({
  issues,
  locatableIds,
  onLocate,
}: {
  issues: AgentBindingIssue[]
  /** 当前画布上可定位的节点 id 集合：循环体内节点在根图视口下不可直接定位。 */
  locatableIds: ReadonlySet<string>
  onLocate: (nodeId: string) => void
}) {
  if (issues.length === 0) return null
  const errorCount = issues.filter((issue) => issue.level === 'error').length
  const warningCount = issues.length - errorCount
  return (
    <div className="wf-agent-issue-panel" role="region" aria-label="执行者校验">
      <div className="wf-agent-issue-head">
        <span className="wf-agent-issue-title">执行者校验</span>
        <span className="wf-agent-issue-counts">
          {errorCount > 0 && <span className="is-error">{errorCount} 个错误</span>}
          {warningCount > 0 && <span className="is-warning">{warningCount} 个提醒</span>}
        </span>
      </div>
      <ul className="wf-agent-issue-list">
        {issues.map((issue) => {
          const locatable = locatableIds.has(issue.nodeId)
          const className = `wf-agent-issue-item is-${issue.level}${locatable ? ' is-locatable' : ''}`
          // 错误（阻断保存）与提醒（有运行时兜底）用不同图标区分严重度。
          const IssueIcon = issue.level === 'error' ? Icons.XCircle : Icons.AlertTriangle
          return (
            <li key={`${issue.code}-${issue.nodeId}`}>
              {locatable ? (
                <button
                  type="button"
                  className={className}
                  title="点击定位到该节点"
                  onClick={() => onLocate(issue.nodeId)}
                >
                  <IssueIcon size={12} />
                  <span className="wf-agent-issue-message">{issue.message}</span>
                </button>
              ) : (
                <div className={className} title="该节点位于循环体内，请打开对应循环体编辑">
                  <IssueIcon size={12} />
                  <span className="wf-agent-issue-message">{issue.message}</span>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
