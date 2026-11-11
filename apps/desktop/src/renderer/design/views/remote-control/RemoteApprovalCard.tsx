/**
 * 远程权限审批卡。
 *
 * 视觉与桌面端内联审批卡完全一致（复用 composer-approval-card 与
 * PermissionRequestDetails），差异只在决策提交：走 remote-agent:target:request
 * 打到目标设备的 /v1/sessions/:id/approvals/:rid/resolve。
 */
import type { PermissionApprovalRequest } from '@spark/protocol'
import { Icons } from '../../Icons'
import { PermissionRequestDetails } from '../../components/PermissionRequestDetails'

export type RemoteApprovalDecision = 'allow-once' | 'allow-session' | 'deny'

const RISK_LABEL = { low: '低', medium: '中', high: '高' } as const

/** 目标设备返回的是 PermissionApprovalRequest 的投影，补齐渲染所需字段 */
export function toApprovalRequest(raw: {
  requestId: string
  sessionId: string
  toolName: string
  action: string
  toolInput?: Record<string, unknown>
  riskLevel: 'low' | 'medium' | 'high'
  createdAt?: string
  defaultToNo?: boolean
}): PermissionApprovalRequest {
  return {
    requestId: raw.requestId,
    sessionId: raw.sessionId,
    toolName: raw.toolName,
    action: raw.action,
    toolInput: raw.toolInput ?? {},
    riskLevel: raw.riskLevel,
    persistentScopes: [],
    ...(raw.createdAt != null ? { createdAt: raw.createdAt } : {}),
    ...(raw.defaultToNo != null ? { defaultToNo: raw.defaultToNo } : {}),
  }
}

export function RemoteApprovalCard({
  request,
  busy,
  onDecide,
}: {
  request: PermissionApprovalRequest
  busy: boolean
  onDecide: (decision: RemoteApprovalDecision) => void
}) {
  const riskTone =
    request.riskLevel === 'high' ? 'high' : request.riskLevel === 'medium' ? 'medium' : 'low'

  return (
    <div className={`composer-approval-card ${riskTone} remote-approval-card`}>
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
              允许在目标电脑上执行 <span>{request.toolName}</span>?
            </div>
            <div className="composer-approval-meta">
              远程会话 · 风险 {RISK_LABEL[request.riskLevel]}
            </div>
          </div>
          <div className="composer-approval-actions">
            <button
              type="button"
              className="composer-approval-btn ghost"
              disabled={busy}
              // 高危询问：焦点落在拒绝上，避免误击批准
              autoFocus={request.defaultToNo === true}
              onClick={() => onDecide('deny')}
            >
              拒绝
            </button>
            <button
              type="button"
              className="composer-approval-btn"
              disabled={busy}
              onClick={() => onDecide('allow-session')}
            >
              会话允许
            </button>
            <button
              type="button"
              className="composer-approval-btn primary"
              disabled={busy}
              onClick={() => onDecide('allow-once')}
            >
              {busy ? '提交中…' : '允许'}
            </button>
          </div>
        </div>
        <PermissionRequestDetails request={request} />
      </div>
    </div>
  )
}
