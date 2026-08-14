import { useState } from 'react'
import type { SessionId } from '@spark/protocol'
import type { UIBlock } from '../../services/event-mapper'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useToast } from '../../components/Toast'
import { Icons } from '../../Icons'

type GoalContractBlock = Extract<UIBlock, { kind: 'goal_contract' }>

const STATE_BADGE: Record<GoalContractBlock['state'], { label: string; color?: string }> = {
  pending: { label: '待确认', color: 'var(--c-warn)' },
  confirmed: { label: '已确认', color: 'var(--c-ok)' },
  rejected: { label: '已拒绝', color: 'var(--c-err)' },
}

/**
 * goal 契约门控的内联审批卡片：目标起草验收契约后停在 pending_contract，
 * 用户在此确认（→ goal_started 开始循环）或拒绝（→ goal_cleared），
 * 不再依赖手动输入 /goal confirm。终态由 event-mapper 收到的 goal_started/goal_cleared 回写。
 */
export function GoalContractCard({
  block,
  sessionId,
}: {
  block: GoalContractBlock
  sessionId: string | null
}) {
  const { toast } = useToast()
  const { invoke: controlGoal } = useIpcInvoke('session:goal-control')
  const [submitting, setSubmitting] = useState<'confirm' | 'reject' | null>(null)
  const [localState, setLocalState] = useState<GoalContractBlock['state'] | null>(null)

  // 事件回流（goal_started/goal_cleared）是权威态；本地 state 仅在事件到达前即时反馈。
  const state = block.state === 'pending' && localState != null ? localState : block.state
  const { successCriteria, constraints, validation } = block.contract
  const commands = validation.commands ?? []
  const checklist = validation.checklist ?? []

  const handleAction = async (action: 'confirm' | 'reject') => {
    if (sessionId == null || submitting != null) return
    setSubmitting(action)
    try {
      const result = (await controlGoal({ sessionId: sessionId as SessionId, action })) as
        | { goal?: { status?: string } | null }
        | null
      const status = result?.goal?.status
      if (action === 'confirm' && status !== 'active') {
        // 契约不完整或已不在 pending_contract：保持卡片，提示原因。
        toast.error('契约缺少验收标准或已失效，未能启动目标。')
        return
      }
      setLocalState(action === 'confirm' ? 'confirmed' : 'rejected')
      toast.success(action === 'confirm' ? '契约已确认，目标开始执行。' : '契约已拒绝，目标已清除。')
    } catch (err) {
      toast.error(`Goal 操作失败：${String(err)}`)
    } finally {
      setSubmitting(null)
    }
  }

  const badge = STATE_BADGE[state]

  return (
    <div className="chat-card">
      <div className="chat-card-h">
        <span className="ico">
          <Icons.Crosshair size={14} />
        </span>
        <span>目标验收契约</span>
        <span
          className="badge"
          style={{ marginLeft: 'auto', fontSize: 10, ...(badge.color != null ? { color: badge.color } : {}) }}
        >
          {badge.label}
        </span>
      </div>
      <div className="chat-card-body">
        <div className="spec-grid">
          <span className="k">目标</span>
          <span className="v">{block.objective}</span>
          {successCriteria.length > 0 && (
            <>
              <span className="k">验收标准</span>
              <span className="v">
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {successCriteria.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </span>
            </>
          )}
          {constraints.length > 0 && (
            <>
              <span className="k">约束</span>
              <span className="v">
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {constraints.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </span>
            </>
          )}
          {commands.length > 0 && (
            <>
              <span className="k">验证命令</span>
              <span className="v">
                {commands.map((cmd) => (
                  <div key={cmd}>
                    <code>{cmd}</code>
                  </div>
                ))}
              </span>
            </>
          )}
          {checklist.length > 0 && (
            <>
              <span className="k">检查清单</span>
              <span className="v">
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {checklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </span>
            </>
          )}
        </div>
        {state === 'pending' ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              className="btn sm"
              disabled={submitting != null}
              onClick={() => void handleAction('reject')}
            >
              {submitting === 'reject' ? '清除中…' : '拒绝'}
            </button>
            <button
              className="btn sm primary"
              disabled={submitting != null}
              onClick={() => void handleAction('confirm')}
            >
              {submitting === 'confirm' ? '启动中…' : '确认并开始执行'}
            </button>
          </div>
        ) : (
          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 12 }}>
            {state === 'confirmed'
              ? '契约已确认，目标进入执行循环。'
              : '契约已拒绝，目标已清除。'}
          </div>
        )}
      </div>
    </div>
  )
}
