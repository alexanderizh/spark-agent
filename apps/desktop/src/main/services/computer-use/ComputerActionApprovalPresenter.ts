import type { ComputerActionEnvelope, ComputerApprovalTicket } from '@spark/protocol'
import { computeComputerApprovalDigests } from './ComputerApprovalService.js'
import type { ComputerApprovalService } from './ComputerApprovalService.js'
import type { ComputerActionApprovalRequest } from './ComputerTaskOperator.js'

export interface ExactComputerActionApprovalPrompt {
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  riskLevel: 'L2' | 'L3'
}

export function createComputerActionApprovalPresenter(options: {
  getApprovals: () => Pick<ComputerApprovalService, 'approve' | 'deny'>
  requestExactApproval: (input: ExactComputerActionApprovalPrompt) => Promise<boolean>
}): (request: ComputerActionApprovalRequest) => Promise<ComputerApprovalTicket | null> {
  return async (request) => {
    const fullAccess = isFullAccess(request.permissionMode)
    const allowed =
      fullAccess ||
      (await options.requestExactApproval({
        sessionId: request.session.sessionId,
        toolName: `mcp__spark_computer__approve_${request.envelope.action.type}`,
        toolInput: buildComputerActionApprovalDetails(request.envelope, request.riskLevel),
        riskLevel: request.riskLevel,
      }))
    const approvals = options.getApprovals()
    if (!allowed) {
      approvals.deny(request.approvalId, request.session.id)
      return null
    }
    return approvals.approve({
      computerSessionId: request.session.id,
      approvalId: request.approvalId,
      ...computeComputerApprovalDigests(request.envelope),
      approvedBy: 'local_user',
      approverId: fullAccess ? 'spark-full-access' : 'spark-main-renderer',
    })
  }
}

function isFullAccess(permissionMode: string): boolean {
  return permissionMode === 'claude-bypass' || permissionMode === 'codex-full-access'
}

export function buildComputerActionApprovalDetails(
  envelope: ComputerActionEnvelope,
  riskLevel: 'L2' | 'L3',
): Record<string, unknown> {
  const action =
    (envelope.action.type === 'type_text' || envelope.action.type === 'set_value') &&
    envelope.action.sensitive === true
      ? {
          type: envelope.action.type,
          sensitive: true,
          textLength:
            envelope.action.type === 'type_text'
              ? envelope.action.text.length
              : envelope.action.value.length,
        }
      : envelope.action
  return {
    computerSessionId: envelope.computerSessionId,
    intent: envelope.intent,
    riskLevel,
    targetAppId: envelope.targetAppId,
    targetWindowId: envelope.targetWindowId,
    target: envelope.policyContext.target,
    action,
  }
}
