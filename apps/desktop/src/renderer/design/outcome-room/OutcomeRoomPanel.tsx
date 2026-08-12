import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Edit3, RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { Modal } from 'antd'
import type {
  OutcomeRoomMutateRequest,
  OutcomeRoomMutationAction,
  OutcomeRoomRecord,
  OutcomeRoomSnapshot,
} from '@spark/protocol'
import {
  displayLedgerValue,
  getLedgerActions,
  outcomeTitle,
  summarizeOutcomeRoom,
} from './outcomeRoomModel'
import './OutcomeRoomPanel.less'

type MutationPayload = Omit<OutcomeRoomMutateRequest, 'sessionId'>

export interface OutcomeRoomPanelProps {
  snapshot: OutcomeRoomSnapshot | null
  loading: boolean
  error: string | null
  runningMemberCount: number
  mutatingKey: string | null
  onRefresh: () => void
  onMutate: (request: MutationPayload) => void | Promise<void>
}

const statusLabels: Record<OutcomeRoomRecord['status'], string> = {
  proposed: '待确认',
  active: '有效',
  rejected: '已驳回',
  invalid: '已失效',
  expired: '已过期',
  deleted: '已删除',
}

const authorityLabels: Record<OutcomeRoomRecord['authority'], string> = {
  'user-confirmed': '用户确认',
  'system-observed': '系统观察',
  'agent-inferred': 'Agent 推断',
}

const actionLabels: Record<OutcomeRoomMutationAction, string> = {
  confirm: '确认',
  reject: '驳回',
  correct: '纠正',
  invalidate: '标记失效',
  restore: '恢复',
}

export function OutcomeRoomPanel(props: OutcomeRoomPanelProps) {
  const { snapshot, loading, error, runningMemberCount, mutatingKey, onRefresh, onMutate } = props
  const summary = useMemo(
    () => summarizeOutcomeRoom(snapshot?.records ?? []),
    [snapshot?.records],
  )
  const [editing, setEditing] = useState<OutcomeRoomRecord | null>(null)
  const [correctionValue, setCorrectionValue] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const discussionId = snapshot?.discussion?.id ?? null

  const openCorrection = (record: OutcomeRoomRecord) => {
    setEditing(record)
    setCorrectionValue(displayLedgerValue(record.value))
    setCorrectionReason('')
  }

  const submitCorrection = () => {
    if (editing == null || correctionValue.trim().length === 0) return
    void onMutate({
      action: 'correct',
      expectedDiscussionId: snapshot?.discussion?.id ?? '',
      expectedRecordId: editing.id,
      logicalKey: editing.logicalKey,
      expectedVersion: editing.version,
      value: correctionValue.trim(),
      ...(correctionReason.trim() ? { reason: correctionReason.trim() } : {}),
    })
    setEditing(null)
  }

  return (
    <section
      aria-label="团队成果作业间"
      className="outcome-room"
      data-outcome-room-layout="responsive"
    >
      <header className="outcome-room-header">
        <div className="outcome-room-heading">
          <span className="outcome-room-kicker">OUTCOME ROOM</span>
          <h3>{snapshot == null ? '团队成果作业间' : outcomeTitle(snapshot)}</h3>
        </div>
        <button
          type="button"
          className="outcome-room-icon-button"
          aria-label="重新加载团队账本"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={15} aria-hidden />
        </button>
      </header>

      {loading && snapshot == null ? (
        <div className="outcome-room-loading" aria-busy="true" aria-live="polite">
          <span className="outcome-room-skeleton wide" />
          <span className="outcome-room-skeleton" />
          <span>正在同步团队账本…</span>
        </div>
      ) : error != null && snapshot == null ? (
        <div className="outcome-room-state error" role="alert">
          <AlertTriangle size={18} aria-hidden />
          <strong>同步失败</strong>
          <p>{error}</p>
          <button type="button" className="outcome-room-secondary" onClick={onRefresh}>
            重试
          </button>
        </div>
      ) : snapshot == null || snapshot.discussion == null || discussionId == null ? (
        <div className="outcome-room-state empty">
          <ShieldCheck size={20} aria-hidden />
          <strong>等待团队讨论开始</strong>
          <p>发起首次团队派发后，这里会自动建立共享成果和关键信息账本。</p>
        </div>
      ) : (
        <>
          {error != null && (
            <div className="outcome-room-inline-error" role="alert">
              <AlertTriangle size={14} aria-hidden />
              {error}
            </div>
          )}
          <div className="outcome-room-overview" aria-label="协作概览">
            <div className={`outcome-room-health ${summary.health}`}>
              <span className="outcome-room-health-mark" aria-hidden />
              <span>
                <small>当前状态</small>
                <strong>{summary.healthLabel}</strong>
              </span>
            </div>
            <dl>
              <div><dt>有效记录</dt><dd>{summary.activeCount}</dd></div>
              <div><dt>待确认</dt><dd>{summary.proposalCount}</dd></div>
              <div><dt>协同状态</dt><dd>{runningMemberCount > 0 ? `${runningMemberCount} 位成员运行中` : '团队空闲'}</dd></div>
              <div><dt>讨论进度</dt><dd>{snapshot.discussion.roundIndex}/{snapshot.discussion.maxRounds} 轮</dd></div>
            </dl>
          </div>

          <div className="outcome-room-ledger-heading">
            <div>
              <h4>团队活页账本</h4>
              <span>每条记录保留来源、权威等级和版本轨迹</span>
            </div>
            <span className="outcome-room-sync">同步于 {formatTime(snapshot.syncedAt)}</span>
          </div>

          {snapshot.records.length === 0 ? (
            <div className="outcome-room-state empty compact">
              <strong>尚无关键信息</strong>
              <p>成员通过 team_ledger_propose 提交后会自动出现在这里。</p>
            </div>
          ) : (
            <div className="outcome-room-ledger-list" role="list" aria-label="团队活页账本记录">
              {snapshot.records.map((record) => (
                <LedgerRecordCard
                  key={record.id}
                  record={record}
                  discussionId={discussionId}
                  busy={mutatingKey === record.logicalKey}
                  onMutate={onMutate}
                  onCorrect={() => openCorrection(record)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        open={editing != null}
        title="纠正账本记录"
        okText="保存新版本"
        cancelText="取消"
        okButtonProps={{ disabled: correctionValue.trim().length === 0 }}
        onOk={submitCorrection}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        <div className="outcome-room-correction-form">
          <label htmlFor="outcome-room-correction-value">新内容</label>
          <textarea
            id="outcome-room-correction-value"
            value={correctionValue}
            onChange={(event) => setCorrectionValue(event.target.value)}
            rows={5}
            maxLength={8_000}
          />
          <label htmlFor="outcome-room-correction-reason">纠正依据（可选）</label>
          <input
            id="outcome-room-correction-reason"
            value={correctionReason}
            onChange={(event) => setCorrectionReason(event.target.value)}
            maxLength={1000}
          />
        </div>
      </Modal>
    </section>
  )
}

function LedgerRecordCard({
  record,
  discussionId,
  busy,
  onMutate,
  onCorrect,
}: {
  record: OutcomeRoomRecord
  discussionId: string
  busy: boolean
  onMutate: OutcomeRoomPanelProps['onMutate']
  onCorrect: () => void
}) {
  const invoke = (action: Exclude<OutcomeRoomMutationAction, 'correct'>) => {
    void onMutate({
      action,
      expectedDiscussionId: discussionId,
      expectedRecordId: record.id,
      logicalKey: record.logicalKey,
      expectedVersion: record.version,
    })
  }
  return (
    <article className={`outcome-room-record status-${record.status}`} role="listitem">
      <div className="outcome-room-version-track" aria-label={`版本 ${record.version}`}>
        <span>v{record.version}</span>
      </div>
      <div className="outcome-room-record-body">
        <div className="outcome-room-record-topline">
          <code>{record.logicalKey}</code>
          <div className="outcome-room-record-badges">
            <span className={`status ${record.status}`}>{statusLabels[record.status]}</span>
            <span>{authorityLabels[record.authority]}</span>
          </div>
        </div>
        <pre>{displayLedgerValue(record.value)}</pre>
        <div className="outcome-room-record-meta">
          <span title={record.sourceRefs.join(' · ')}>来源 {clipDisplay(record.sourceRefs.join(' · ') || '未标注', 180)}</span>
          <span title={record.updatedBy}>{clipDisplay(record.updatedBy, 80)}</span>
          <time dateTime={record.updatedAt}>{formatTime(record.updatedAt)}</time>
        </div>
        {record.reason && <p className="outcome-room-record-reason">依据：{record.reason}</p>}
        <div className="outcome-room-record-actions">
          {getLedgerActions(record).map((action) => {
            if (action === 'correct') {
              return (
                <button
                  key={action}
                  type="button"
                  aria-label={`纠正 ${record.logicalKey}`}
                  disabled={busy}
                  onClick={onCorrect}
                >
                  <Edit3 size={13} aria-hidden /> {actionLabels[action]}
                </button>
              )
            }
            return (
              <button
                key={action}
                type="button"
                className={action === 'confirm' || action === 'restore' ? 'primary' : ''}
                aria-label={`${actionLabels[action]} ${record.logicalKey}`}
                disabled={busy}
                onClick={() => invoke(action)}
              >
                {action === 'confirm' && <Check size={13} aria-hidden />}
                {action === 'reject' && <X size={13} aria-hidden />}
                {action === 'invalidate' && <AlertTriangle size={13} aria-hidden />}
                {action === 'restore' && <RotateCcw size={13} aria-hidden />}
                {actionLabels[action]}
              </button>
            )
          })}
        </div>
      </div>
    </article>
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function clipDisplay(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`
}
