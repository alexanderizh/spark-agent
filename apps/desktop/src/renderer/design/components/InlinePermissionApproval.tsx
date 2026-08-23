import { useCallback, useEffect, useState } from 'react'
import type { PermissionApprovalDecision, PermissionApprovalRequest } from '@spark/protocol'
import { Icons } from '../Icons'
import { useToast } from './Toast'
import { PermissionRequestDetails } from './PermissionRequestDetails'

export function InlinePermissionApproval({
  request,
  onClose,
}: {
  request: PermissionApprovalRequest
  onClose?: () => void
}) {
  const { toast } = useToast()
  const [busyDecision, setBusyDecision] = useState<PermissionApprovalDecision | null>(null)
  const riskLabel = { low: '低', medium: '中', high: '高' }[request.riskLevel]
  const riskTone =
    request.riskLevel === 'high' ? 'high' : request.riskLevel === 'medium' ? 'medium' : 'low'

  const respond = useCallback(
    async (decision: PermissionApprovalDecision) => {
      setBusyDecision(decision)
      let shouldClose = false
      try {
        const result = await window.spark.invoke('permission:approval-respond', {
          requestId: request.requestId,
          decision,
        })
        if (result?.ok === false) {
          toast.warning('该权限请求已失效（等待超时或会话已取消），你的选择未生效')
        }
        shouldClose = true
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '提交权限审批失败')
      } finally {
        setBusyDecision(null)
        if (shouldClose) onClose?.()
      }
    },
    [onClose, request.requestId, toast],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busyDecision != null) return
      event.preventDefault()
      void respond('deny')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [busyDecision, respond])

  return (
    <div className={`composer-approval-card ${riskTone}`}>
      <div className="composer-approval-icon">
        {request.riskLevel === 'high' ? (
          <Icons.AlertTriangle size={17} />
        ) : (
          <Icons.Shield size={17} />
        )}
      </div>
      <div className="composer-approval-main">
        <div className="composer-approval-top">
          <div>
            <div className="composer-approval-title">
              允许执行 <span>{request.toolName}</span>?
            </div>
            <div className="composer-approval-meta">
              Session {request.sessionId.slice(0, 8)} · 风险 {riskLabel}
            </div>
          </div>
          <div className="composer-approval-actions">
            <button
              type="button"
              className="composer-approval-btn ghost"
              disabled={busyDecision != null}
              onClick={() => void respond('deny')}
            >
              拒绝
            </button>
            <button
              type="button"
              className="composer-approval-btn"
              disabled={busyDecision != null}
              onClick={() => void respond('deny-session')}
            >
              会话拒绝
            </button>
            <button
              type="button"
              className="composer-approval-btn"
              disabled={busyDecision != null}
              onClick={() => void respond('allow-session')}
            >
              会话允许
            </button>
            <button
              type="button"
              className="composer-approval-btn primary"
              disabled={busyDecision != null}
              onClick={() => void respond('allow-once')}
            >
              {busyDecision === 'allow-once' ? <Icons.Spinner size={13} /> : null}
              允许
            </button>
          </div>
        </div>
        <PermissionRequestDetails request={request} />
      </div>
    </div>
  )
}
