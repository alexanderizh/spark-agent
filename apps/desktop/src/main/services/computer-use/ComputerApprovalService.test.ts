import type { ComputerActionEnvelope } from '@spark/protocol'
import type { ComputerApprovalRow, CreatePendingComputerApprovalParams } from '@spark/storage'
import { describe, expect, it } from 'vitest'
import { ComputerApprovalService, type ComputerApprovalStore } from './ComputerApprovalService.js'

const NOW = '2026-07-28T05:00:00.000Z'

function envelope(overrides: Partial<ComputerActionEnvelope> = {}): ComputerActionEnvelope {
  return {
    computerSessionId: 'computer-session-1',
    actionId: 'action-1',
    actuatorLeaseId: 'lease-1',
    observedFrameId: 'frame-1',
    observedTreeVersion: 'tree-1',
    targetAppId: 'com.spark.Mail',
    targetWindowId: 'compose-window',
    action: { type: 'invoke_element', elementId: 'send-button', action: 'invoke' },
    policyContext: {
      effect: 'external_write',
      target: { kind: 'recipient', id: 'recipient-alice' },
      dataClasses: ['internal'],
    },
    intent: 'Send the approved message to Alice',
    ...overrides,
  }
}

class MemoryApprovalStore implements ComputerApprovalStore {
  readonly rows = new Map<string, ComputerApprovalRow>()

  createPending(params: CreatePendingComputerApprovalParams): ComputerApprovalRow {
    const row: ComputerApprovalRow = {
      id: params.id,
      computer_session_id: params.computerSessionId,
      action_id: params.actionId,
      risk_level: params.riskLevel,
      action_digest: params.actionDigest,
      target_digest: params.targetDigest,
      data_class_digest: params.dataClassDigest,
      approved_by: null,
      approver_id: null,
      nonce_hash: null,
      approved_at: null,
      expires_at: params.expiresAt,
      used_at: null,
      decision: 'pending',
      created_at: params.createdAt,
    }
    this.rows.set(row.id, row)
    return row
  }

  get(id: string): ComputerApprovalRow | null {
    return this.rows.get(id) ?? null
  }

  findPendingByAction(
    computerSessionId: string,
    actionId: string,
    now: string,
  ): ComputerApprovalRow | null {
    return (
      [...this.rows.values()].find(
        (row) =>
          row.computer_session_id === computerSessionId &&
          row.action_id === actionId &&
          row.decision === 'pending' &&
          row.expires_at > now,
      ) ?? null
    )
  }

  approve(params: {
    id: string
    approvedBy: 'local_user' | 'remote_device'
    approverId: string
    nonceHash: string
    approvedAt: string
  }): ComputerApprovalRow | null {
    const row = this.get(params.id)
    if (
      row == null ||
      row.decision !== 'pending' ||
      row.expires_at <= params.approvedAt ||
      (params.approvedBy === 'remote_device' && row.risk_level !== 'L2')
    ) {
      return null
    }
    const approved: ComputerApprovalRow = {
      ...row,
      approved_by: params.approvedBy,
      approver_id: params.approverId,
      nonce_hash: params.nonceHash,
      approved_at: params.approvedAt,
      decision: 'approved',
    }
    this.rows.set(row.id, approved)
    return approved
  }

  consume(params: {
    id: string
    nonceHash: string
    actionDigest: string
    targetDigest: string
    dataClassDigest: string | null
    usedAt: string
  }): boolean {
    const row = this.get(params.id)
    if (
      row == null ||
      row.decision !== 'approved' ||
      row.used_at !== null ||
      row.approved_at == null ||
      row.approved_at > params.usedAt ||
      row.expires_at <= params.usedAt ||
      row.nonce_hash !== params.nonceHash ||
      row.action_digest !== params.actionDigest ||
      row.target_digest !== params.targetDigest ||
      row.data_class_digest !== params.dataClassDigest
    ) {
      return false
    }
    this.rows.set(row.id, { ...row, used_at: params.usedAt })
    return true
  }

  denyPendingForSession(computerSessionId: string): number {
    let denied = 0
    for (const [id, row] of this.rows) {
      if (
        row.computer_session_id !== computerSessionId ||
        (row.decision !== 'pending' && !(row.decision === 'approved' && row.used_at === null))
      ) {
        continue
      }
      this.rows.set(id, { ...row, decision: 'denied' })
      denied += 1
    }
    return denied
  }

  deny(id: string, computerSessionId: string, deniedAt: string): boolean {
    const row = this.get(id)
    if (
      row == null ||
      row.computer_session_id !== computerSessionId ||
      row.decision !== 'pending' ||
      row.created_at > deniedAt
    ) {
      return false
    }
    this.rows.set(id, { ...row, decision: 'denied' })
    return true
  }
}

function createService(store = new MemoryApprovalStore()): ComputerApprovalService {
  let nextId = 1
  return new ComputerApprovalService({
    repository: store,
    now: () => new Date(NOW),
    createId: () => `approval-${nextId++}`,
    createNonce: () => 'nonce-1234567890abcdef',
  })
}

describe('ComputerApprovalService', () => {
  it('binds a one-time ticket to action, target, data classes and expiry', () => {
    const service = createService()
    const pending = service.request(envelope(), 'L2')
    expect(service.request(envelope(), 'L2').id).toBe(pending.id)
    const ticket = service.approve({
      computerSessionId: 'computer-session-1',
      approvalId: pending.id,
      actionDigest: pending.action_digest,
      targetDigest: pending.target_digest,
      dataClassDigest: pending.data_class_digest,
      approvedBy: 'local_user',
      approverId: 'local-user',
    })

    expect(ticket).toMatchObject({
      id: 'approval-1',
      computerSessionId: 'computer-session-1',
      actionId: 'action-1',
      riskLevel: 'L2',
      nonce: 'nonce-1234567890abcdef',
      usedAt: null,
    })
    expect(() => service.consume(ticket, envelope(), 'L2')).not.toThrow()
    expect(() => service.consume(ticket, envelope(), 'L2')).toThrowError(
      expect.objectContaining({ code: 'approval_mismatch' }),
    )
  })

  it('rejects tickets when executable parameters or policy context change', () => {
    const service = createService()
    const pending = service.request(envelope(), 'L2')
    expect(() =>
      service.approve({
        computerSessionId: 'computer-session-1',
        approvalId: pending.id,
        actionDigest: 'f'.repeat(64),
        targetDigest: pending.target_digest,
        dataClassDigest: pending.data_class_digest,
        approvedBy: 'local_user',
        approverId: 'local-user',
      }),
    ).toThrowError(expect.objectContaining({ code: 'approval_mismatch' }))
    const ticket = service.approve({
      computerSessionId: 'computer-session-1',
      approvalId: pending.id,
      actionDigest: pending.action_digest,
      targetDigest: pending.target_digest,
      dataClassDigest: pending.data_class_digest,
      approvedBy: 'local_user',
      approverId: 'local-user',
    })

    expect(() =>
      service.consume(
        ticket,
        envelope({ action: { type: 'invoke_element', elementId: 'delete-button' } }),
        'L2',
      ),
    ).toThrowError(expect.objectContaining({ code: 'approval_mismatch' }))
    expect(() =>
      service.consume(
        ticket,
        envelope({
          policyContext: {
            effect: 'external_write',
            target: { kind: 'recipient', id: 'recipient-bob' },
            dataClasses: ['personal'],
          },
        }),
        'L2',
      ),
    ).toThrowError(expect.objectContaining({ code: 'approval_mismatch' }))
    expect(() =>
      service.consume(ticket, envelope({ intent: 'Delete the message instead' }), 'L2'),
    ).toThrowError(expect.objectContaining({ code: 'approval_mismatch' }))
    expect(() =>
      service.consume(
        ticket,
        envelope({
          expectedPostcondition: {
            kind: 'visual',
            assertion: { operator: 'text_present', expected: 'Deleted' },
          },
        }),
        'L2',
      ),
    ).toThrowError(expect.objectContaining({ code: 'approval_mismatch' }))
  })

  it('never allows remote approval for L3', () => {
    const service = createService()
    const pending = service.request(
      envelope({
        policyContext: {
          effect: 'high_impact',
          target: { kind: 'system_setting', id: 'network-proxy' },
          dataClasses: [],
        },
      }),
      'L3',
    )

    expect(() =>
      service.approve({
        computerSessionId: 'computer-session-1',
        approvalId: pending.id,
        actionDigest: pending.action_digest,
        targetDigest: pending.target_digest,
        dataClassDigest: pending.data_class_digest,
        approvedBy: 'remote_device',
        approverId: 'paired-device',
      }),
    ).toThrowError(expect.objectContaining({ code: 'approval_mismatch' }))
  })

  it('rejects expired approvals and clears pending approvals on stop', () => {
    const store = new MemoryApprovalStore()
    const service = createService(store)
    const pending = service.request(envelope(), 'L2', { ttlMs: 1 })
    store.rows.set(pending.id, {
      ...pending,
      expires_at: '2026-07-28T04:59:59.999Z',
    })

    expect(() =>
      service.approve({
        computerSessionId: 'computer-session-1',
        approvalId: pending.id,
        actionDigest: pending.action_digest,
        targetDigest: pending.target_digest,
        dataClassDigest: pending.data_class_digest,
        approvedBy: 'local_user',
        approverId: 'local-user',
      }),
    ).toThrowError(expect.objectContaining({ code: 'approval_expired' }))

    service.request(envelope({ actionId: 'action-2' }), 'L2')
    expect(service.cancelPending('computer-session-1')).toBe(2)
  })

  it('allows the owning session to deny one pending approval', () => {
    const store = new MemoryApprovalStore()
    const service = createService(store)
    const pending = service.request(envelope(), 'L2')

    expect(service.deny(pending.id, 'other-session')).toBe(false)
    expect(service.deny(pending.id, 'computer-session-1')).toBe(true)
    expect(store.get(pending.id)?.decision).toBe('denied')
    expect(() =>
      service.approve({
        computerSessionId: 'computer-session-1',
        approvalId: pending.id,
        actionDigest: pending.action_digest,
        targetDigest: pending.target_digest,
        dataClassDigest: pending.data_class_digest,
        approvedBy: 'local_user',
        approverId: 'local-user',
      }),
    ).toThrowError(expect.objectContaining({ code: 'approval_mismatch' }))
  })

  it('revokes an approved but unconsumed ticket when the session stops', () => {
    const store = new MemoryApprovalStore()
    const service = createService(store)
    const pending = service.request(envelope(), 'L2')
    const ticket = service.approve({
      computerSessionId: 'computer-session-1',
      approvalId: pending.id,
      actionDigest: pending.action_digest,
      targetDigest: pending.target_digest,
      dataClassDigest: pending.data_class_digest,
      approvedBy: 'local_user',
      approverId: 'local-user',
    })

    expect(service.cancelPending('computer-session-1')).toBe(1)
    expect(store.get(pending.id)?.decision).toBe('denied')
    expect(() => service.consume(ticket, envelope(), 'L2')).toThrowError(
      expect.objectContaining({ code: 'approval_mismatch' }),
    )
  })

  it('binds IPC approval to the owning session and hands the nonce to the executor once', () => {
    const service = createService()
    const pending = service.request(envelope(), 'L2')

    expect(() =>
      service.approve({
        computerSessionId: 'other-session',
        approvalId: pending.id,
        actionDigest: pending.action_digest,
        targetDigest: pending.target_digest,
        dataClassDigest: pending.data_class_digest,
        approvedBy: 'local_user',
        approverId: 'renderer:41',
      }),
    ).toThrowError(expect.objectContaining({ code: 'approval_mismatch' }))

    const ticket = service.approve({
      computerSessionId: 'computer-session-1',
      approvalId: pending.id,
      actionDigest: pending.action_digest,
      targetDigest: pending.target_digest,
      dataClassDigest: pending.data_class_digest,
      approvedBy: 'local_user',
      approverId: 'renderer:41',
    })

    expect(service.takeApprovedTicket(ticket.id)).toEqual(ticket)
    expect(service.takeApprovedTicket(ticket.id)).toBeNull()
  })
})
