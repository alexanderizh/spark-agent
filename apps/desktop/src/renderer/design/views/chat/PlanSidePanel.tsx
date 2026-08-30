import { useState } from 'react'
import { Button } from '@lobehub/ui'
import type { SessionId } from '@spark/protocol'
import { Icons } from '../../Icons'
import type { SessionSummary } from '../../SessionSidebarContext'
import { useToast } from '../../components/Toast'
import type { UIMessage } from '../../services/event-mapper'
import { MarkdownText } from './ChatMarkdown'
import { extractPlans } from './ChatInspectorUtils'
import { writeComposerPrefs } from './ComposerV2'
import { PlanSummary } from './PlanSummary'

export function PlanSidePanel({
  session,
  messages,
  proposedPlan,
  onClearProposedPlan,
  onPlanApproved,
}: {
  session: SessionSummary | null
  messages: UIMessage[]
  proposedPlan: { sessionId: SessionId; plan: string } | null
  onClose: () => void
  onClearProposedPlan: () => void
  onPlanApproved: (sessionId: SessionId) => void
}) {
  const plans = extractPlans(messages).filter(
    (plan) =>
      proposedPlan == null || plan.kind !== 'proposal' || plan.rawPlan !== proposedPlan.plan,
  )
  const progressPlans = plans.filter((plan) => plan.kind === 'progress')
  const proposalHistory = plans.filter((plan) => plan.kind === 'proposal')
  const hasPlan = proposedPlan != null || plans.length > 0
  const isPlanMode = session?.permissionMode === 'claude-plan'

  return (
    <div className="inspector-frame embedded">
      <div className="inspector scroll">
        {proposedPlan != null && isPlanMode && (
          <PlanApprovalPanel
            sessionId={proposedPlan.sessionId}
            plan={proposedPlan.plan}
            onClose={onClearProposedPlan}
            onPlanApproved={onPlanApproved}
          />
        )}

        {proposedPlan != null && !isPlanMode && (
          <div className="inspector-section">
            <h4>最新方案</h4>
            <div className="plan-approval-body md-surface">
              <MarkdownText content={proposedPlan.plan} />
            </div>
          </div>
        )}

        {!hasPlan && (
          <div className="inspector-section">
            <div className="inspector-muted">暂无计划。Agent 生成计划后会自动显示在这里。</div>
          </div>
        )}

        {progressPlans.length > 0 && (
          <div className="inspector-section">
            <h4>执行进度</h4>
            {progressPlans.map((plan) => (
              <PlanSummary key={plan.id} plan={plan} renderMarkdown={MarkdownText} />
            ))}
          </div>
        )}

        {proposalHistory.length > 0 && (
          <div className="inspector-section">
            <h4>历史方案</h4>
            {proposalHistory.map((plan) => (
              <PlanSummary key={plan.id} plan={plan} renderMarkdown={MarkdownText} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PlanApprovalPanel({
  sessionId,
  plan,
  onClose,
  onPlanApproved,
}: {
  sessionId: SessionId
  plan: string
  onClose: () => void
  onPlanApproved: (sessionId: SessionId) => void
}) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(plan)
  const [editBuffer, setEditBuffer] = useState(plan)
  const [busy, setBusy] = useState(false)
  const isEdited = draft !== plan

  const approve = async () => {
    if (busy) return
    setBusy(true)
    try {
      await window.spark.invoke('session:submit-turn', {
        sessionId,
        message: `批准上述计划。请按如下计划继续执行：\n\n${draft}`,
        permissionMode: 'claude-auto-edits',
        interruptActive: true,
      })
      writeComposerPrefs({ permissionMode: 'claude-auto-edits' })
      onPlanApproved(sessionId)
      toast.success('计划已批准，已切换为自动执行模式')
      onClose()
    } catch (err) {
      toast.error(`批准失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (busy) return
    setBusy(true)
    try {
      // 精准拒绝：后端解除该会话的 plan 审批闸门 + 写入持久化的 plan_rejected 标记。
      await window.spark.invoke('session:reject-plan', { sessionId })
    } catch {
      // 后端清理失败不应阻塞前端关闭审批面板。
    } finally {
      setBusy(false)
    }
    toast.success('已拒绝计划，未执行')
    onClose()
  }

  return (
    <div className="plan-approval">
      {editing ? (
        <textarea
          className="plan-approval-textarea"
          value={editBuffer}
          onChange={(event) => setEditBuffer(event.target.value)}
          rows={Math.min(24, Math.max(12, editBuffer.split('\n').length + 1))}
          autoFocus
        />
      ) : (
        <div className="plan-approval-body md-surface">
          <MarkdownText content={draft} />
        </div>
      )}
      <div className="plan-approval-foot">
        {!editing && (
          <Button
            type="text"
            size="small"
            danger
            disabled={busy}
            onClick={reject}
            icon={<Icons.X size={14} />}
          >
            拒绝
          </Button>
        )}
        <div className="flex1" />
        {!editing && isEdited && (
          <Button
            type="text"
            size="small"
            disabled={busy}
            icon={<Icons.RotateCcw size={14} />}
            onClick={() => {
              setDraft(plan)
              setEditBuffer(plan)
            }}
          >
            恢复原计划
          </Button>
        )}
        {!editing && (
          <Button
            type="text"
            size="small"
            disabled={busy}
            icon={<Icons.Edit size={14} />}
            onClick={() => {
              setEditBuffer(draft)
              setEditing(true)
            }}
          >
            编辑
          </Button>
        )}
        {editing && (
          <Button type="text" size="small" onClick={() => setEditing(false)}>
            放弃修改
          </Button>
        )}
        {editing && (
          <Button
            type="primary"
            size="small"
            disabled={editBuffer === draft}
            icon={<Icons.Check size={14} />}
            onClick={() => {
              setDraft(editBuffer)
              setEditing(false)
            }}
          >
            保存编辑
          </Button>
        )}
        {!editing && (
          <Button
            type="primary"
            size="small"
            loading={busy}
            onClick={approve}
            icon={<Icons.Check size={14} />}
          >
            批准执行
          </Button>
        )}
      </div>
    </div>
  )
}
