import type { SessionId } from '@spark/protocol'
import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react'
import { Button } from '@lobehub/ui'
import { useEvidenceCost, type CostAggregate, type EvidenceRecord } from './useEvidenceCost'
import './EvidenceCostPanel.less'

const MAX_VISIBLE_ITEMS = 100

export function EvidenceCostPanel({
  sessionId,
  discussionId,
}: {
  sessionId: SessionId | undefined
  discussionId: string | undefined
}) {
  const state = useEvidenceCost(sessionId, discussionId)
  if (sessionId == null) return null

  const snapshot = state.snapshot
  const conflict = state.error != null && /conflict|expected|version|切换/i.test(state.error)
  const hasContent =
    snapshot != null &&
    (snapshot.evidence.length > 0 ||
      snapshot.costs.length > 0 ||
      snapshot.aggregates.length > 0 ||
      snapshot.budgetTokens != null ||
      snapshot.budgetAmount != null)
  const aggregates =
    snapshot?.aggregates
      .filter(
        (aggregate) =>
          aggregate.dimension === 'room' ||
          aggregate.dimension === 'task' ||
          aggregate.dimension === 'agent',
      )
      .slice(0, MAX_VISIBLE_ITEMS) ?? []
  const remainingTokens =
    snapshot?.budgetTokens != null && aggregates.length > 0
      ? snapshot.budgetTokens -
        aggregates.reduce((sum, aggregate) => sum + (aggregate.tokens ?? 0), 0)
      : null

  return (
    <section className="evidence-cost-panel" aria-label="证据与成本" data-evidence-cost-panel>
      <header className="evidence-cost-panel__header">
        <div>
          <span className="evidence-cost-panel__eyebrow">EVIDENCE / COST LEDGER</span>
          <h3>证据与成本账本</h3>
          <p>来源、核验状态与团队消耗在同一讨论上下文中可追溯。</p>
        </div>
        <Button
          type="text"
          size="small"
          aria-label="重新加载证据与成本"
          onClick={() => void state.refresh()}
          disabled={state.loading}
        >
          <RefreshCw size={15} aria-hidden />
        </Button>
      </header>

      {state.loading && snapshot == null && (
        <div className="evidence-cost-panel__state" aria-busy="true" aria-live="polite">
          <span className="evidence-cost-panel__loading-mark" aria-hidden />
          <strong>正在同步证据与成本…</strong>
          <span>会话切换期间会自动丢弃旧响应。</span>
        </div>
      )}

      {state.error != null && (
        <div
          className={`evidence-cost-panel__notice ${conflict ? 'is-conflict' : ''}`}
          role="alert"
        >
          {conflict ? (
            <ShieldAlert size={16} aria-hidden />
          ) : (
            <AlertTriangle size={16} aria-hidden />
          )}
          <div>
            <strong>{conflict ? '数据版本冲突' : '账本同步失败'}</strong>
            <span>{state.error}</span>
          </div>
          <button type="button" onClick={() => void state.refresh()}>
            重试
          </button>
        </div>
      )}

      {!state.loading && !hasContent && state.error == null && (
        <div className="evidence-cost-panel__state is-empty">
          <CircleHelp size={20} aria-hidden />
          <strong>当前尚未记录证据或成本</strong>
          <span>团队开始提交证据或记录用量后，账本会出现在这里。</span>
        </div>
      )}

      {(hasContent || state.loading) && snapshot != null && (
        <div className="evidence-cost-panel__content">
          <div className="evidence-cost-panel__summary" aria-label="账本概览">
            <Metric label="证据" value={snapshot.evidence.length} />
            <Metric label="用量事件" value={snapshot.costs.length} />
            <Metric
              label="预算剩余"
              value={formatTokens(remainingTokens)}
              warning={remainingTokens != null && remainingTokens < 0}
            />
          </div>

          <div className="evidence-cost-panel__columns">
            <EvidenceSection
              evidence={snapshot.evidence.slice(0, MAX_VISIBLE_ITEMS)}
              mutatingKey={state.mutatingKey}
              onMutate={state.mutate}
            />
            <CostSection aggregates={aggregates} snapshot={snapshot} />
          </div>
        </div>
      )}
    </section>
  )
}

function EvidenceSection({
  evidence,
  mutatingKey,
  onMutate,
}: {
  evidence: EvidenceRecord[]
  mutatingKey: string | null
  onMutate: ReturnType<typeof useEvidenceCost>['mutate']
}) {
  if (evidence.length === 0)
    return <div className="evidence-cost-panel__substate">暂无证据记录。</div>
  return (
    <div className="evidence-cost-panel__section" data-evidence-list>
      <div className="evidence-cost-panel__section-heading">
        <h4>
          Evidence <span>{evidence.length}</span>
        </h4>
        <span>最多展示 100 条</span>
      </div>
      <div className="evidence-cost-panel__evidence-list">
        {evidence.map((item) => {
          const key = `evidence:${item.id}:${item.status}:${item.versionNumber}`
          const busy = mutatingKey === key
          return (
            <article key={item.id} className="evidence-cost-panel__evidence-card">
              <div className="evidence-cost-panel__card-topline">
                <span className={`evidence-cost-panel__status is-${item.status}`}>
                  {item.status === 'verified' ? (
                    <CheckCircle2 size={14} aria-hidden />
                  ) : item.status === 'invalid' ? (
                    <XCircle size={14} aria-hidden />
                  ) : (
                    <CircleHelp size={14} aria-hidden />
                  )}
                  {statusLabel(item.status)}
                </span>
                <span className="evidence-cost-panel__version">v{item.versionNumber}</span>
              </div>
              <strong>{item.claim}</strong>
              <p>{item.summary}</p>
              <div className="evidence-cost-panel__metadata">
                <span>
                  来源：{sourceLabel(item.source.type)} · {item.source.ref}
                </span>
                <span>
                  回链：
                  {item.links.length > 0
                    ? item.links.map((link) => `${link.type}/${link.id}`).join(' · ')
                    : '无'}
                </span>
              </div>
              <div className="evidence-cost-panel__actions">
                {item.status !== 'verified' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void onMutate({
                        kind: 'evidence',
                        action: 'verify',
                        id: item.id,
                        expectedVersion: item.versionNumber,
                      })
                    }
                  >
                    <CheckCircle2 size={14} aria-hidden /> 核验
                  </button>
                )}
                {item.status !== 'invalid' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void onMutate({
                        kind: 'evidence',
                        action: 'invalidate',
                        id: item.id,
                        expectedVersion: item.versionNumber,
                        reason: '用户在 Outcome Room 中标记为无效',
                      })
                    }
                  >
                    <XCircle size={14} aria-hidden /> 标记无效
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

function CostSection({
  aggregates,
  snapshot,
}: {
  aggregates: CostAggregate[]
  snapshot: ReturnType<typeof useEvidenceCost>['snapshot']
}) {
  if (aggregates.length === 0 && (snapshot?.costs.length ?? 0) === 0)
    return <div className="evidence-cost-panel__substate">暂无成本记录。</div>
  return (
    <div className="evidence-cost-panel__section" data-cost-list>
      <div className="evidence-cost-panel__section-heading">
        <h4>
          Cost <span>{snapshot?.costs.length ?? 0}</span>
        </h4>
        <span>按 Room / Task / Agent 聚合</span>
      </div>
      <div className="evidence-cost-panel__cost-list">
        {aggregates.map((aggregate) => (
          <article
            key={`${aggregate.dimension}:${aggregate.key}`}
            className="evidence-cost-panel__cost-card"
          >
            <div>
              <strong>{dimensionLabel(aggregate.dimension)}</strong>
              <span>{aggregate.key}</span>
            </div>
            <div className="evidence-cost-panel__cost-value">
              <strong>{formatTokens(aggregate.tokens)}</strong>
              {aggregate.unknown && <span className="evidence-cost-panel__unknown">含未知</span>}
            </div>
            <small>
              {aggregate.eventCount} 个事件
              {aggregate.amount != null
                ? ` · ${aggregate.amount} ${snapshot?.budgetCurrency ?? ''}`
                : ''}
            </small>
          </article>
        ))}
        {(snapshot?.costs.some((cost) => cost.status === 'unknown' || cost.tokens == null) ??
          false) && (
          <div className="evidence-cost-panel__warning">
            <AlertTriangle size={14} aria-hidden /> 部分成本缺少可计量数据，已保留为未知。
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  warning = false,
}: {
  label: string
  value: string | number
  warning?: boolean
}) {
  return (
    <div className={`evidence-cost-panel__metric ${warning ? 'is-warning' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function statusLabel(status: EvidenceRecord['status']): string {
  return status === 'verified' ? '已核验' : status === 'invalid' ? '已标记无效' : '待确认'
}
function sourceLabel(source: EvidenceRecord['source']['type']): string {
  return { file: '文件', test: '测试', tool: '工具', url: 'URL', manual: '手工' }[source]
}
function dimensionLabel(dimension: CostAggregate['dimension']): string {
  return { room: 'Room', task: 'Task', agent: 'Agent', dispatch: 'Dispatch' }[dimension]
}
function formatTokens(value: number | null): string {
  return value == null ? '未知' : value.toLocaleString()
}
