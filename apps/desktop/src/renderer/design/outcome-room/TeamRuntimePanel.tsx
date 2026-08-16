import { useMemo, useState } from 'react'
import type {
  DeliberationRecord,
  DeliberationSnapshot,
  SessionId,
  TaskGraphSnapshot,
  TaskNode,
  TaskNodeStatus,
} from '@spark/protocol'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  GitBranch,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@lobehub/ui'
import {
  useTeamRuntime,
  type DeliberationMutationPayload,
  type TaskGraphMutationPayload,
} from './useTeamRuntime'
import './TeamRuntimePanel.less'

const MAX_VISIBLE_ITEMS = 100

const taskStatusLabels: Record<TaskNodeStatus, string> = {
  ready: '待执行',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  blocked: '已阻塞',
  cancelled: '已取消',
}

const taskStatusIcons: Record<TaskNodeStatus, string> = {
  ready: '○',
  running: '◐',
  completed: '✓',
  failed: '!',
  blocked: '⊘',
  cancelled: '×',
}

export function TeamRuntimePanel({ sessionId }: { sessionId: SessionId | undefined }) {
  const runtime = useTeamRuntime(sessionId)
  const [activeTab, setActiveTab] = useState<'tasks' | 'deliberation'>('tasks')

  if (sessionId == null) return null

  const hasRuntimeData = runtime.taskGraph != null || runtime.deliberation != null
  const conflict = runtime.error != null && isConflictError(runtime.error)

  return (
    <section className="team-runtime-panel" aria-label="团队运行时" data-runtime-panel>
      <header className="team-runtime-panel__header">
        <div>
          <span className="team-runtime-panel__eyebrow">TEAM RUNTIME / OUTCOME ROOM</span>
          <h3>任务图与结构化审议</h3>
          <p>依赖、责任人与决策状态在同一条协作上下文中保持可追踪。</p>
        </div>
        <Button
          type="text"
          size="small"
          aria-label="重新加载团队运行时"
          onClick={() => void runtime.refresh()}
          disabled={runtime.loading}
        >
          <RefreshCw size={15} aria-hidden />
        </Button>
      </header>

      {runtime.loading && !hasRuntimeData && (
        <div className="team-runtime-panel__state" aria-busy="true" aria-live="polite">
          <span className="team-runtime-panel__loading-mark" aria-hidden />
          <strong>正在同步运行时快照…</strong>
          <span>会话切换期间会自动丢弃旧响应。</span>
        </div>
      )}

      {runtime.error != null && (
        <div className={`team-runtime-panel__notice ${conflict ? 'is-conflict' : ''}`} role="alert">
          {conflict ? (
            <ShieldAlert size={16} aria-hidden />
          ) : (
            <AlertTriangle size={16} aria-hidden />
          )}
          <div>
            <strong>{conflict ? '数据版本冲突' : '运行时同步失败'}</strong>
            <span>{runtime.error}</span>
          </div>
          <button type="button" onClick={() => void runtime.refresh()}>
            重试
          </button>
        </div>
      )}

      {!runtime.loading && !hasRuntimeData && runtime.error == null && (
        <div className="team-runtime-panel__state is-empty">
          <GitBranch size={20} aria-hidden />
          <strong>当前尚未建立运行时数据</strong>
          <span>团队开始派发任务或发起审议后，节点与决策会出现在这里。</span>
        </div>
      )}

      {(hasRuntimeData || runtime.loading) && (
        <>
          <nav className="team-runtime-panel__tabs" aria-label="运行时视图">
            <button
              type="button"
              className={activeTab === 'tasks' ? 'is-active' : ''}
              aria-selected={activeTab === 'tasks'}
              role="tab"
              onClick={() => setActiveTab('tasks')}
            >
              <GitBranch size={15} aria-hidden />
              任务图
              <span>{runtime.taskGraph?.nodes.length ?? 0}</span>
            </button>
            <button
              type="button"
              className={activeTab === 'deliberation' ? 'is-active' : ''}
              aria-selected={activeTab === 'deliberation'}
              role="tab"
              onClick={() => setActiveTab('deliberation')}
            >
              <ShieldAlert size={15} aria-hidden />
              审议
              <span>{runtime.deliberation?.records.length ?? 0}</span>
            </button>
          </nav>

          {activeTab === 'tasks' ? (
            <TaskGraphSection
              snapshot={runtime.taskGraph}
              mutatingKey={runtime.mutatingKey}
              onMutate={runtime.mutateTaskGraph}
            />
          ) : (
            <DeliberationSection
              snapshot={runtime.deliberation}
              mutatingKey={runtime.mutatingKey}
              onMutate={runtime.mutateDeliberation}
            />
          )}
        </>
      )}
    </section>
  )
}

function TaskGraphSection({
  snapshot,
  mutatingKey,
  onMutate,
}: {
  snapshot: TaskGraphSnapshot | null
  mutatingKey: string | null
  onMutate: (payload: TaskGraphMutationPayload) => Promise<void>
}) {
  const nodes = snapshot?.nodes.slice(0, MAX_VISIBLE_ITEMS) ?? []
  const edges = useMemo(() => snapshot?.edges.slice(0, MAX_VISIBLE_ITEMS) ?? [], [snapshot?.edges])
  const dependencies = useMemo(() => {
    const byTarget = new Map<string, string[]>()
    for (const edge of edges) {
      const current = byTarget.get(edge.toNodeId) ?? []
      current.push(edge.fromNodeId)
      byTarget.set(edge.toNodeId, current)
    }
    return byTarget
  }, [edges])

  if (snapshot == null || (nodes.length === 0 && edges.length === 0)) {
    return (
      <div className="team-runtime-panel__state is-empty compact">
        <GitBranch size={18} aria-hidden />
        <strong>暂无任务节点</strong>
        <span>任务图会展示依赖、并行关系、阻塞传播和执行责任。</span>
      </div>
    )
  }

  return (
    <div className="team-runtime-panel__content" data-task-graph>
      <div className="team-runtime-panel__summary" aria-label="任务图概览">
        <Metric label="节点" value={snapshot.nodes.length} />
        <Metric
          label="依赖"
          value={snapshot.edges.filter((edge) => edge.type === 'dependency').length}
        />
        <Metric
          label="执行中"
          value={snapshot.nodes.filter((node) => node.status === 'running').length}
        />
        <Metric
          label="阻塞"
          value={snapshot.nodes.filter((node) => node.status === 'blocked').length}
        />
      </div>
      <div className="team-runtime-panel__graph-legend" aria-label="任务图说明">
        <span>
          <i className="legend-line" aria-hidden />
          依赖
        </span>
        <span>
          <i className="legend-dot" aria-hidden />
          状态
        </span>
        <span className="team-runtime-panel__sync">
          讨论 {snapshot.discussionId ?? '未建立'} · {formatTime(snapshot.syncedAt)}
        </span>
      </div>
      <div className="team-runtime-panel__node-list" role="list" aria-label="任务节点列表">
        {nodes.map((node) => (
          <TaskNodeCard
            key={node.id}
            node={node}
            dependencyIds={dependencies.get(node.id) ?? []}
            busy={mutatingKey != null && mutatingKey.includes(node.id)}
            onMutate={onMutate}
          />
        ))}
      </div>
      {snapshot.nodes.length > MAX_VISIBLE_ITEMS && (
        <p className="team-runtime-panel__limit-note">
          已展示前 {MAX_VISIBLE_ITEMS} 个节点，剩余节点请通过筛选或列表分页查看。
        </p>
      )}
    </div>
  )
}

function TaskNodeCard({
  node,
  dependencyIds,
  busy,
  onMutate,
}: {
  node: TaskNode
  dependencyIds: string[]
  busy: boolean
  onMutate: (payload: TaskGraphMutationPayload) => Promise<void>
}) {
  const [assignee, setAssignee] = useState(node.assigneeId ?? '')
  const transition = (status: TaskNodeStatus) =>
    void onMutate({
      expectedDiscussionId: node.discussionId,
      kind: 'node',
      action: 'transition',
      id: node.id,
      expectedVersion: node.version,
      status,
    })
  const retry = () =>
    void onMutate({
      expectedDiscussionId: node.discussionId,
      kind: 'node',
      action: 'retry',
      id: node.id,
      expectedVersion: node.version,
    })
  const reassign = () =>
    void onMutate({
      expectedDiscussionId: node.discussionId,
      kind: 'node',
      action: 'reassign',
      id: node.id,
      expectedVersion: node.version,
      assigneeId: assignee.trim() || null,
    })

  return (
    <article
      className={`team-runtime-node status-${node.status}`}
      role="listitem"
      data-node-id={node.id}
    >
      <div className="team-runtime-node__rail" aria-hidden>
        <span>{taskStatusIcons[node.status]}</span>
      </div>
      <div className="team-runtime-node__body">
        <div className="team-runtime-node__topline">
          <div>
            <strong>{clip(node.title, 180)}</strong>
            <code>{clip(node.id, 72)}</code>
          </div>
          <span className={`team-runtime-status status-${node.status}`}>
            {taskStatusIcons[node.status]} {taskStatusLabels[node.status]}
          </span>
        </div>
        {node.description && <p>{clip(node.description, 280)}</p>}
        <div className="team-runtime-node__meta">
          <span>负责人：{node.assigneeId ?? '未分配'}</span>
          <span>
            验收：
            {node.acceptanceStatus === 'accepted'
              ? '通过'
              : node.acceptanceStatus === 'rejected'
                ? '驳回'
                : '待验收'}
          </span>
          <span>
            重试 {node.retryCount}/{node.maxRetries}
          </span>
        </div>
        {dependencyIds.length > 0 && (
          <div className="team-runtime-node__dependencies" aria-label={`${node.title} 的前置依赖`}>
            <GitBranch size={13} aria-hidden />
            <span>前置</span>
            {dependencyIds.slice(0, 8).map((id) => (
              <code key={id}>{clip(id, 32)}</code>
            ))}
          </div>
        )}
        <div className="team-runtime-node__actions">
          {(node.status === 'failed' || node.status === 'cancelled') && (
            <button
              type="button"
              onClick={retry}
              disabled={busy}
              aria-label={`重试任务 ${node.title}`}
            >
              <RotateCcw size={14} aria-hidden />
              重试
            </button>
          )}
          {node.status === 'ready' && (
            <button type="button" onClick={() => transition('running')} disabled={busy}>
              开始执行
            </button>
          )}
          {node.status === 'running' && (
            <button type="button" onClick={() => transition('completed')} disabled={busy}>
              <Check size={14} aria-hidden />
              完成
            </button>
          )}
          <label className="team-runtime-node__assign">
            <span>转派</span>
            <input
              value={assignee}
              maxLength={160}
              onChange={(event) => setAssignee(event.target.value)}
              placeholder="成员 ID"
              aria-label={`任务 ${node.title} 的负责人`}
            />
            <button type="button" onClick={reassign} disabled={busy}>
              保存
            </button>
          </label>
        </div>
      </div>
    </article>
  )
}

function DeliberationSection({
  snapshot,
  mutatingKey,
  onMutate,
}: {
  snapshot: DeliberationSnapshot | null
  mutatingKey: string | null
  onMutate: (payload: DeliberationMutationPayload) => Promise<void>
}) {
  const records = snapshot?.records.slice(0, MAX_VISIBLE_ITEMS) ?? []
  if (snapshot == null || records.length === 0) {
    return (
      <div className="team-runtime-panel__state is-empty compact">
        <ShieldAlert size={18} aria-hidden />
        <strong>暂无结构化审议</strong>
        <span>提案、证据、替代方案、风险与裁决会在这里串成可回链的决策记录。</span>
      </div>
    )
  }
  return (
    <div className="team-runtime-panel__content" data-deliberation>
      <div className="team-runtime-panel__summary" aria-label="审议概览">
        <Metric label="提案" value={snapshot.records.length} />
        <Metric label="冲突" value={snapshot.conflicts.length} />
        <Metric
          label="已裁决"
          value={snapshot.records.filter((record) => record.decision != null).length}
        />
        <Metric
          label="待治理"
          value={snapshot.records.filter((record) => record.decision == null).length}
        />
      </div>
      <div className="team-runtime-panel__record-list" role="list" aria-label="结构化审议记录">
        {records.map((record) => (
          <DeliberationCard
            key={record.id}
            record={record}
            busy={mutatingKey != null && mutatingKey.includes(record.id)}
            onMutate={onMutate}
          />
        ))}
      </div>
      {snapshot.records.length > MAX_VISIBLE_ITEMS && (
        <p className="team-runtime-panel__limit-note">已展示前 {MAX_VISIBLE_ITEMS} 条审议记录。</p>
      )}
    </div>
  )
}

function DeliberationCard({
  record,
  busy,
  onMutate,
}: {
  record: DeliberationRecord
  busy: boolean
  onMutate: (payload: DeliberationMutationPayload) => Promise<void>
}) {
  const base = {
    expectedDiscussionId: record.discussionId,
    expectedRecordId: record.id,
    expectedVersion: record.version,
    id: record.id,
  }
  const vote = (position: 'support' | 'oppose' | 'conditional') =>
    void onMutate({
      ...base,
      action: 'vote',
      vote: { position, reason: '用户在 Outcome Room 提交表决。' },
    })
  const decide = (outcome: 'approved' | 'rejected' | 'conditional') =>
    void onMutate({
      ...base,
      action: 'decide',
      decision: { outcome, reason: '用户在 Outcome Room 完成裁决。', ledgerWrite: null },
    })
  const resolve = () => {
    const other = record.conflict?.recordIds.find((id) => id !== record.id)
    if (other == null) return
    void onMutate({
      ...base,
      action: 'resolve',
      conflictingRecordId: other,
      reason: '用户在 Outcome Room 处理冲突。',
    })
  }
  return (
    <article
      className={`team-runtime-deliberation ${record.conflict != null ? 'is-conflict' : ''}`}
      role="listitem"
      data-deliberation-id={record.id}
    >
      <div className="team-runtime-deliberation__topline">
        <div>
          <span className="team-runtime-panel__eyebrow">PROPOSAL · v{record.version}</span>
          <h4>{clip(record.topic, 180)}</h4>
        </div>
        <span className={`team-runtime-status status-${record.status}`}>
          {record.decision == null
            ? '待裁决'
            : `已${record.decision.outcome === 'approved' ? '批准' : record.decision.outcome === 'rejected' ? '驳回' : '条件通过'}`}
        </span>
      </div>
      <div className="team-runtime-deliberation__proposal">
        <strong>
          {record.proposal.position === 'support'
            ? '支持'
            : record.proposal.position === 'oppose'
              ? '反对'
              : '条件通过'}
          ：{clip(record.proposal.claim, 260)}
        </strong>
        <p>{clip(record.proposal.rationale, 320)}</p>
      </div>
      <div className="team-runtime-deliberation__columns">
        <DeliberationList
          title="Evidence / 证据"
          values={record.evidence.map((item) => `${item.summary} · ${item.sourceRef}`)}
        />
        <DeliberationList
          title="Alternatives / 替代方案"
          values={record.alternatives.map((item) => `${item.title}：${item.summary}`)}
        />
        <DeliberationList
          title="Risks / 风险"
          values={record.risks.map(
            (item) => `${item.severity.toUpperCase()} · ${item.title}：${item.mitigation}`,
          )}
        />
      </div>
      <div className="team-runtime-deliberation__meta">
        <span>Owner：{record.ownerId ?? '未指定'}</span>
        <span>Deadline：{record.deadline ? formatTime(record.deadline) : '未指定'}</span>
        <span>
          表决记录：{record.evidence.filter((item) => item.sourceRef.startsWith('vote:')).length}
        </span>
      </div>
      {record.decision != null && (
        <p className="team-runtime-deliberation__decision">
          <Check size={14} aria-hidden />
          {clip(record.decision.reason, 300)}
        </p>
      )}
      {record.conflict != null && (
        <div className="team-runtime-deliberation__conflict" role="status">
          <ShieldAlert size={15} aria-hidden />
          <span>冲突：{clip(record.conflict.reason, 220)}</span>
          {record.conflict.resolvedBy == null && (
            <button type="button" onClick={resolve} disabled={busy}>
              处理冲突
            </button>
          )}
        </div>
      )}
      <details className="team-runtime-deliberation__actions">
        <summary>
          <ChevronDown size={14} aria-hidden />
          用户治理操作
        </summary>
        <div>
          <button type="button" onClick={() => vote('support')} disabled={busy}>
            支持
          </button>
          <button type="button" onClick={() => vote('oppose')} disabled={busy}>
            反对
          </button>
          <button type="button" onClick={() => vote('conditional')} disabled={busy}>
            条件通过
          </button>
          {record.decision == null && (
            <>
              <button type="button" onClick={() => decide('approved')} disabled={busy}>
                裁决批准
              </button>
              <button type="button" onClick={() => decide('rejected')} disabled={busy}>
                裁决驳回
              </button>
            </>
          )}
        </div>
      </details>
    </article>
  )
}

function DeliberationList({ title, values }: { title: string; values: string[] }) {
  return (
    <div className="team-runtime-deliberation__list">
      <strong>{title}</strong>
      {values.length === 0 ? (
        <span className="is-muted">暂无</span>
      ) : (
        values
          .slice(0, 8)
          .map((value, index) => <span key={`${value}-${index}`}>{clip(value, 220)}</span>)
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function isConflictError(value: string): boolean {
  return /conflict|version|cas|冲突|版本/i.test(value)
}
