import { Icons } from '../../Icons'
import type { LoopBodySummary } from './loop-body-editor'

export function WorkflowLoopBodySummary({
  summary,
  jsonDraft,
  jsonError,
  onOpen,
  onReset,
  onJsonChange,
}: {
  summary: LoopBodySummary
  jsonDraft: string
  jsonError: string
  onOpen: () => void
  onReset: () => void
  onJsonChange: (value: string) => void
}) {
  return (
    <div className="wf-loop-summary">
      <div className="wf-loop-summary-head">
        <div>
          <strong>循环体子图</strong>
          <span>使用工作流节点、连线与条件边进行编排。</span>
        </div>
        <span className="wf-loop-summary-orientation">
          {summary.orientation === 'vertical' ? '纵向' : '横向'}
        </span>
      </div>
      <div className="wf-loop-summary-stats" aria-label="循环体统计">
        <span>{summary.nodeCount} 个节点</span>
        <span>{summary.edgeCount} 条连线</span>
        <span>{summary.conditionalEdgeCount} 条条件边</span>
      </div>
      <div className="wf-loop-summary-actions">
        <button type="button" className="wf-loop-open-button" onClick={onOpen}>
          <Icons.Workflow size={13} />
          编辑循环体
        </button>
        <button type="button" className="wf-loop-reset-button" onClick={onReset}>
          重置默认循环体
        </button>
      </div>
      <details className="wf-loop-json-details">
        <summary>高级 JSON</summary>
        <div className="wf-field-help">仅建议用于导入或排错；普通编排请使用上方可视化编辑器。</div>
        <textarea
          rows={9}
          value={jsonDraft}
          onChange={(event) => onJsonChange(event.target.value)}
        />
        {jsonError.length > 0 && <div className="wf-field-help wf-field-warn">{jsonError}</div>}
      </details>
    </div>
  )
}
