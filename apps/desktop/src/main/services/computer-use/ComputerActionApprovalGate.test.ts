import type { ComputerActionEnvelope, ComputerApprovalTicket } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'

import { ComputerActionApprovalGate } from './ComputerActionApprovalGate.js'
import type { ComputerUseTimelineSink } from './ComputerUseTimelineStore.js'

const envelope: ComputerActionEnvelope = {
  computerSessionId: 'cs-1',
  actionId: 'act-1',
  actuatorLeaseId: 'lease-1',
  observedFrameId: 'frame-1',
  observedTreeVersion: 'tree-1',
  targetAppId: 'com.spark.Editor',
  targetWindowId: 'win-1',
  action: { type: 'set_value', elementId: 'el', value: 'v' },
  policyContext: {
    effect: 'reversible_local',
    target: { kind: 'element', id: 'el' },
    dataClasses: [],
  },
  intent: 'test',
}

interface MemoryRow {
  id: string
  computer_session_id: string
  action_id: string
  risk_level: 'L2' | 'L3'
  action_digest: string
  target_digest: string
  data_class_digest: string | null
  approved_by: 'local_user' | 'remote_device' | null
  approver_id: string | null
  nonce_hash: string | null
  decision: 'pending' | 'approved' | 'denied' | 'expired'
  approved_at: string | null
  used_at: string | null
  expires_at: string
  created_at: string
}

function createMemoryApprovals(startAt: Date) {
  const rows = new Map<string, MemoryRow>()
  const tickets = new Map<string, ComputerApprovalTicket>()
  let clock = new Date(startAt)
  let seq = 0
  return {
    rows,
    advanceTo(next: Date): void {
      clock = next
    },
    request: vi.fn(() => {
      seq += 1
      const row: MemoryRow = {
        id: `approval-${seq}`,
        computer_session_id: envelope.computerSessionId,
        action_id: envelope.actionId,
        risk_level: 'L2',
        action_digest: 'd',
        target_digest: 't',
        data_class_digest: null,
        approved_by: null,
        approver_id: null,
        nonce_hash: null,
        decision: 'pending',
        approved_at: null,
        used_at: null,
        expires_at: new Date(clock.getTime() + 5 * 60_000).toISOString(),
        created_at: clock.toISOString(),
      }
      rows.set(row.id, row)
      return row
    }),
    approve: vi.fn((input: { approvalId: string }) => {
      const row = rows.get(input.approvalId)
      if (row == null) throw new Error('missing approval')
      row.decision = 'approved'
      row.approved_at = clock.toISOString()
      const ticket = {
        id: row.id,
        computerSessionId: row.computer_session_id,
        actionId: envelope.actionId,
        riskLevel: 'L2' as const,
        actionDigest: 'd',
        targetDigest: 't',
        dataClassDigest: null,
        approvedBy: 'local_user' as const,
        approverId: 'spark-pip-panel',
        approvedAt: row.approved_at,
        expiresAt: row.expires_at,
        nonce: 'n',
        usedAt: null,
      }
      tickets.set(row.id, ticket)
      return ticket
    }),
    deny: vi.fn((approvalId: string) => {
      const row = rows.get(approvalId)
      if (row == null) return false
      row.decision = 'denied'
      return true
    }),
    get: vi.fn((approvalId: string) => rows.get(approvalId) ?? null),
    takeTicket(id: string): ComputerApprovalTicket | undefined {
      return tickets.get(id)
    },
  }
}

function createHarness(options: { startAt?: Date } = {}) {
  const approvals = createMemoryApprovals(options.startAt ?? new Date('2026-10-01T00:00:00Z'))
  const timeline: ComputerUseTimelineSink = { record: vi.fn() }
  let now = options.startAt ?? new Date('2026-10-01T00:00:00Z')
  const gate = new ComputerActionApprovalGate({
    approvals,
    timeline,
    now: () => now,
    pollIntervalMs: 1,
  })
  return {
    gate,
    approvals,
    timeline,
    advanceNow(next: Date): void {
      now = next
    },
  }
}

describe('ComputerActionApprovalGate', () => {
  it('gates only registered non full-access sessions on L2/L3', () => {
    const { gate } = createHarness()
    expect(gate.requiresApproval('cs-1', 'L2')).toBe(false)
    gate.registerPermissionMode('cs-1', 'default')
    expect(gate.requiresApproval('cs-1', 'L3')).toBe(true)
    expect(gate.requiresApproval('cs-1', 'L2')).toBe(true)
    expect(gate.requiresApproval('cs-1', 'L1')).toBe(false)
    expect(gate.requiresApproval('cs-2', 'L3')).toBe(false)
    gate.registerPermissionMode('cs-full', 'claude-bypass')
    expect(gate.requiresApproval('cs-full', 'L3')).toBe(false)
    gate.registerPermissionMode('cs-codex', 'codex-full-access')
    expect(gate.requiresApproval('cs-codex', 'L2')).toBe(false)
  })

  it('resolves approved from the panel and returns the ticket', async () => {
    const { gate, approvals, timeline } = createHarness()
    gate.registerPermissionMode('cs-1', 'default')
    const pending = gate.awaitApproval({
      envelope,
      riskLevel: 'L2',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      summary: '写入文档',
    })
    await vi.waitFor(() => {
      expect(timeline.record).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'computer_approval_requested', riskLevel: 'L2' }),
      )
    })
    expect(gate.resolveFromPanel('cs-1', true)).toBe(true)
    const ticket = await pending
    expect(ticket).toMatchObject({ id: 'approval-1', riskLevel: 'L2' })
    expect(approvals.takeTicket('approval-1')).toBeDefined()
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'computer_approval_resolved', decision: 'approved' }),
    )
  })

  it('resolves denied from the panel and returns null', async () => {
    const { gate, timeline } = createHarness()
    gate.registerPermissionMode('cs-1', 'default')
    const pending = gate.awaitApproval({
      envelope,
      riskLevel: 'L2',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      summary: '写入文档',
    })
    expect(gate.resolveFromPanel('cs-1', false)).toBe(true)
    await expect(pending).resolves.toBeNull()
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'computer_approval_resolved', decision: 'denied' }),
    )
  })

  it('fails closed when the pending row is denied out-of-band (session stop)', async () => {
    const { gate, approvals } = createHarness()
    gate.registerPermissionMode('cs-1', 'default')
    const pending = gate.awaitApproval({
      envelope,
      riskLevel: 'L2',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      summary: '写入文档',
    })
    // broker.stop() runs cancelPending → denyPendingForSession; emulate it.
    approvals.rows.get('approval-1')!.decision = 'denied'
    await expect(pending).resolves.toBeNull()
  })

  it('expires the wait when the TTL elapses without an answer', async () => {
    const start = new Date('2026-10-01T00:00:00Z')
    const { gate, timeline, advanceNow } = createHarness({ startAt: start })
    gate.registerPermissionMode('cs-1', 'default')
    const pending = gate.awaitApproval({
      envelope,
      riskLevel: 'L2',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      summary: '写入文档',
    })
    advanceNow(new Date(start.getTime() + 6 * 60_000))
    await expect(pending).resolves.toBeNull()
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'computer_approval_resolved', decision: 'expired' }),
    )
  })

  it('ignores panel resolves for sessions without a pending gate', () => {
    const { gate } = createHarness()
    expect(gate.resolveFromPanel('cs-none', true)).toBe(false)
  })
})
