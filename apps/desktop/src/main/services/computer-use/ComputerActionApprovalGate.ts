import type { ComputerActionEnvelope, ComputerApprovalTicket } from '@spark/protocol'
import { createLogger } from '@spark/shared'

import { computeComputerApprovalDigests } from './ComputerApprovalService.js'
import type { ComputerApprovalService } from './ComputerApprovalService.js'
import type { ComputerUseTimelineSink } from './ComputerUseTimelineStore.js'

const log = createLogger('computer-use-approval-gate')

/** Permission modes that skip per-action approval gating entirely. */
const FULL_ACCESS_PERMISSION_MODES = new Set(['claude-bypass', 'codex-full-access'])

interface PendingGate {
  envelope: ComputerActionEnvelope
  approvalId: string
  riskLevel: 'L2' | 'L3'
  computerSessionId: string
  sessionId: string
  turnId: string
  summary: string
  /** Ticket once the panel approves; 'denied' once refused. */
  settled: ComputerApprovalTicket | 'denied' | null
  expiresAt: string
}

export interface ComputerActionApprovalGateOptions {
  approvals: Pick<ComputerApprovalService, 'request' | 'approve' | 'deny' | 'get'>
  timeline?: ComputerUseTimelineSink
  now?: () => Date
  /** Approval wait poll cadence (default 400ms). */
  pollIntervalMs?: number
  /** How long the user has to answer before the gate fails closed. */
  approvalTtlMs?: number
}

/**
 * Per-action human approval gate for L2/L3 computer actions. A session only
 * gets gated after {@link registerPermissionMode} bound it to a non
 * full-access agent permission mode; unregistered sessions (tests, legacy
 * callers) keep the old ungated behaviour.
 *
 * The wait settles through the approval store's own row state on a short
 * poll: panel approve/deny, TTL expiry and session-stop denial
 * (`cancelPending`) all converge on the same DB transition, so there is a
 * single source of truth and no resolver registry to keep in sync. The gate
 * holds the dispatch's envelope only for the duration of the wait, so
 * approve() can re-derive the binding digests without trusting the panel.
 */
export class ComputerActionApprovalGate {
  private readonly approvals: ComputerActionApprovalGateOptions['approvals']
  private readonly timeline: ComputerUseTimelineSink | undefined
  private readonly now: () => Date
  private readonly pollIntervalMs: number
  private readonly approvalTtlMs: number
  private readonly permissionModes = new Map<string, string>()
  private readonly pending = new Map<string, PendingGate>()

  constructor(options: ComputerActionApprovalGateOptions) {
    this.approvals = options.approvals
    this.timeline = options.timeline
    this.now = options.now ?? (() => new Date())
    this.pollIntervalMs = options.pollIntervalMs ?? 400
    this.approvalTtlMs = options.approvalTtlMs ?? 5 * 60 * 1_000
  }

  /** Binds the agent permission mode gating a computer session. */
  registerPermissionMode(computerSessionId: string, permissionMode: string): void {
    this.permissionModes.set(computerSessionId, permissionMode)
  }

  forgetSession(computerSessionId: string): void {
    this.permissionModes.delete(computerSessionId)
    this.pending.delete(computerSessionId)
  }

  /** True when the action must be approved by a human before execution. */
  requiresApproval(computerSessionId: string, riskLevel: 'L0' | 'L1' | 'L2' | 'L3'): boolean {
    if (riskLevel !== 'L2' && riskLevel !== 'L3') return false
    const mode = this.permissionModes.get(computerSessionId)
    if (mode == null) return false
    return !FULL_ACCESS_PERMISSION_MODES.has(mode)
  }

  /**
   * Blocks until the user approves (ticket returned) or denies/expires the
   * action (null). Best-effort single in-flight wait per session: the broker
   * already serializes dispatches per session.
   */
  async awaitApproval(input: {
    envelope: ComputerActionEnvelope
    riskLevel: 'L2' | 'L3'
    sessionId: string
    turnId: string
    summary: string
  }): Promise<ComputerApprovalTicket | null> {
    const { envelope } = input
    const row = this.approvals.request(envelope, input.riskLevel, {
      ttlMs: this.approvalTtlMs,
    })
    const gate: PendingGate = {
      envelope,
      approvalId: row.id,
      riskLevel: input.riskLevel,
      computerSessionId: envelope.computerSessionId,
      sessionId: input.sessionId,
      turnId: input.turnId,
      summary: input.summary,
      settled: null,
      expiresAt: row.expires_at,
    }
    this.pending.set(envelope.computerSessionId, gate)
    this.timeline?.record({
      type: 'computer_approval_requested',
      sessionId: input.sessionId,
      turnId: input.turnId,
      computerSessionId: envelope.computerSessionId,
      approvalId: row.id,
      actionId: envelope.actionId,
      riskLevel: input.riskLevel,
    })
    try {
      return await this.waitForSettlement(gate)
    } finally {
      if (this.pending.get(envelope.computerSessionId) === gate) {
        this.pending.delete(envelope.computerSessionId)
      }
    }
  }

  /** Resolves the session's pending approval from the PIP panel. */
  resolveFromPanel(computerSessionId: string, approved: boolean): boolean {
    const gate = this.pending.get(computerSessionId)
    if (gate == null || gate.settled != null) return false
    if (!approved) {
      this.approvals.deny(gate.approvalId, computerSessionId)
      return true
    }
    const digests = computeComputerApprovalDigests(gate.envelope)
    try {
      gate.settled = this.approvals.approve({
        computerSessionId,
        approvalId: gate.approvalId,
        actionDigest: digests.actionDigest,
        targetDigest: digests.targetDigest,
        dataClassDigest: digests.dataClassDigest,
        approvedBy: 'local_user',
        approverId: 'spark-pip-panel',
      })
      return true
    } catch (error) {
      log.warn('PIP approval failed to issue a ticket', { error: stringify(error) })
      return false
    }
  }

  private async waitForSettlement(gate: PendingGate): Promise<ComputerApprovalTicket | null> {
    for (;;) {
      const settled = gate.settled
      if (settled != null) {
        if (settled === 'denied') {
          this.recordResolved(gate, 'denied')
          return null
        }
        this.recordResolved(gate, 'approved')
        return settled
      }
      const row = this.approvals.get(gate.approvalId)
      if (row == null) {
        this.recordResolved(gate, 'denied')
        return null
      }
      if (row.approved_at != null) {
        // Approved through a path that holds the ticket elsewhere (the
        // persisted-approval UI); this gate cannot recover the nonce, so it
        // fails closed instead of executing ungated.
        log.warn('Computer approval was settled outside the gate; failing closed', {
          computerSessionId: gate.computerSessionId,
          approvalId: gate.approvalId,
        })
        this.recordResolved(gate, 'denied')
        return null
      }
      const at = this.now().toISOString()
      if (row.decision === 'denied' || row.decision === 'expired' || row.used_at != null) {
        this.recordResolved(gate, row.decision === 'expired' ? 'expired' : 'denied')
        return null
      }
      if (row.expires_at <= at) {
        this.approvals.deny(gate.approvalId, gate.computerSessionId)
        this.recordResolved(gate, 'expired')
        return null
      }
      await sleep(this.pollIntervalMs)
    }
  }

  private recordResolved(gate: PendingGate, decision: 'approved' | 'denied' | 'expired'): void {
    this.timeline?.record({
      type: 'computer_approval_resolved',
      sessionId: gate.sessionId,
      turnId: gate.turnId,
      computerSessionId: gate.computerSessionId,
      approvalId: gate.approvalId,
      actionId: gate.envelope.actionId,
      decision,
    })
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function stringify(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
