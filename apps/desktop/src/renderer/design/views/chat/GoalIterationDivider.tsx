import { Icons } from '../../Icons'
import type { UIBlock } from '../../services/event-mapper'

type GoalIterationDividerBlock = Extract<UIBlock, { kind: 'goal_iteration_divider' }>

const STATE_META: Record<
  GoalIterationDividerBlock['state'],
  { label?: string; className: string }
> = {
  running: { className: 'running' },
  result: { className: 'result' },
  completed: { label: '目标已完成', className: 'completed' },
  failed: { label: '目标未达成', className: 'failed' },
  stopped_by_budget: { label: '已达预算上限，目标停止', className: 'stopped' },
}

/**
 * 目标模式迭代轮次分割线：goal 多轮迭代之间没有用户消息，视觉上轮与轮无缝粘连。
 * 每轮启动型 goal_progress（progressKind=iteration_start）落此分割线，
 * 轮末 iteration_result 回填 agent 自报小结，目标终态事件置完成/失败/预算停止态。
 * 样式与 team-round-divider 同风格（styles/views.css）。
 */
export function GoalIterationDivider({ block }: { block: GoalIterationDividerBlock }) {
  const meta = STATE_META[block.state] ?? STATE_META.running
  const iterationLabel =
    block.maxIterations != null
      ? `第 ${block.iteration} 轮 / 共 ${block.maxIterations} 轮`
      : `第 ${block.iteration} 轮`
  return (
    <div
      className={`goal-iteration-divider ${meta.className}`}
      role="separator"
      aria-label={`目标迭代 ${iterationLabel}${meta.label != null ? ` · ${meta.label}` : ''}`}
    >
      <div className="goal-iteration-divider-row">
        <span className="goal-iteration-divider-line" />
        <span className="goal-iteration-divider-label">
          {block.state === 'running' ? (
            <Icons.Spinner size={12} className="goal-iteration-spinner" />
          ) : null}
          <span>{iterationLabel}</span>
          {meta.label != null ? (
            <span className="goal-iteration-divider-state">{meta.label}</span>
          ) : null}
        </span>
        <span className="goal-iteration-divider-line" />
      </div>
      {block.resultSummary != null && block.resultSummary.length > 0 ? (
        <div className="goal-iteration-divider-summary">
          <span className="goal-iteration-divider-summary-text" title={block.resultSummary}>
            {block.resultSummary}
          </span>
          {block.resultNextStep != null && block.resultNextStep.length > 0 ? (
            <span
              className="goal-iteration-divider-next"
              title={block.resultNextStep}
            >{`→ ${block.resultNextStep}`}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
