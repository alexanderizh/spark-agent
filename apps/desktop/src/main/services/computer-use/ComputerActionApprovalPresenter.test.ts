import type { ComputerActionApprovalRequest } from './ComputerTaskOperator.js'
import { describe, expect, it, vi } from 'vitest'
import {
  buildComputerActionApprovalDetails,
  createComputerActionApprovalPresenter,
} from './ComputerActionApprovalPresenter.js'

const REQUEST = {
  session: {
    id: 'computer-1',
    sessionId: 'session-1',
  },
  envelope: {
    computerSessionId: 'computer-1',
    actionId: 'action-1',
    actuatorLeaseId: 'lease-1',
    observedFrameId: 'frame-1',
    observedTreeVersion: 'tree-1',
    targetAppId: 'app-1',
    targetWindowId: 'window-1',
    action: { type: 'type_text', text: 'top-secret', sensitive: true },
    policyContext: {
      effect: 'reversible_local',
      target: { kind: 'element', id: 'field-1' },
      dataClasses: ['personal'],
    },
    intent: 'Fill the approved field',
  },
  approvalId: 'approval-1',
  riskLevel: 'L2',
} as ComputerActionApprovalRequest

describe('ComputerActionApprovalPresenter', () => {
  it('redacts sensitive text while retaining the exact governed target and action identity', () => {
    const details = buildComputerActionApprovalDetails(REQUEST.envelope, 'L2')

    expect(details).toMatchObject({
      computerSessionId: 'computer-1',
      targetAppId: 'app-1',
      targetWindowId: 'window-1',
      action: { type: 'type_text', sensitive: true, textLength: 10 },
    })
    expect(JSON.stringify(details)).not.toContain('top-secret')
  })

  it('mints the one-time digest-bound ticket only after exact local approval', async () => {
    const ticket = { id: 'approval-1' }
    const approvals = {
      approve: vi.fn(() => ticket),
      deny: vi.fn(),
    }
    const requestExactApproval = vi.fn(async () => true)
    const presenter = createComputerActionApprovalPresenter({
      getApprovals: () => approvals as never,
      requestExactApproval,
    })

    await expect(presenter(REQUEST)).resolves.toBe(ticket)
    expect(requestExactApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        toolName: 'mcp__spark_computer__approve_type_text',
        riskLevel: 'L2',
      }),
    )
    expect(approvals.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        computerSessionId: 'computer-1',
        approvalId: 'approval-1',
        approvedBy: 'local_user',
      }),
    )
    expect(approvals.deny).not.toHaveBeenCalled()
  })

  it('denies the pending Broker approval when the local user rejects it', async () => {
    const approvals = { approve: vi.fn(), deny: vi.fn(() => true) }
    const presenter = createComputerActionApprovalPresenter({
      getApprovals: () => approvals as never,
      requestExactApproval: vi.fn(async () => false),
    })

    await expect(presenter(REQUEST)).resolves.toBeNull()
    expect(approvals.deny).toHaveBeenCalledWith('approval-1', 'computer-1')
    expect(approvals.approve).not.toHaveBeenCalled()
  })
})
