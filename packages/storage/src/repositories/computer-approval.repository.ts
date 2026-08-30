import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface ComputerApprovalRow {
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
  approved_at: string | null
  expires_at: string
  used_at: string | null
  decision: 'pending' | 'approved' | 'denied' | 'expired'
  created_at: string
}

export interface CreatePendingComputerApprovalParams {
  id: string
  computerSessionId: string
  actionId: string
  riskLevel: 'L2' | 'L3'
  actionDigest: string
  targetDigest: string
  dataClassDigest: string | null
  expiresAt: string
  createdAt: string
}

export class ComputerApprovalRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'computer_approvals')
  }

  createPending(params: CreatePendingComputerApprovalParams): ComputerApprovalRow {
    this.raw
      .prepare(
        `INSERT INTO computer_approvals (
           id, computer_session_id, action_id, risk_level, action_digest, target_digest,
           data_class_digest, approved_by, approver_id, nonce_hash, approved_at,
           expires_at, used_at, decision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL, 'pending', ?)`,
      )
      .run(
        params.id,
        params.computerSessionId,
        params.actionId,
        params.riskLevel,
        params.actionDigest,
        params.targetDigest,
        params.dataClassDigest,
        params.expiresAt,
        params.createdAt,
      )
    return this.require(params.id)
  }

  get(id: string): ComputerApprovalRow | null {
    return this.findById<ComputerApprovalRow>(id)
  }

  findPendingByAction(
    computerSessionId: string,
    actionId: string,
    now: string,
  ): ComputerApprovalRow | null {
    return (
      (this.raw
        .prepare(
          `SELECT * FROM computer_approvals
           WHERE computer_session_id = ?
             AND action_id = ?
             AND decision = 'pending'
             AND expires_at > ?
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(computerSessionId, actionId, now) as ComputerApprovalRow | undefined) ?? null
    )
  }

  approve(params: {
    id: string
    approvedBy: 'local_user' | 'remote_device'
    approverId: string
    nonceHash: string
    approvedAt: string
  }): ComputerApprovalRow | null {
    const result = this.raw
      .prepare(
        `UPDATE computer_approvals
         SET approved_by = ?, approver_id = ?, nonce_hash = ?, approved_at = ?, decision = 'approved'
         WHERE id = ?
           AND decision = 'pending'
           AND expires_at > ?
           AND (? != 'remote_device' OR risk_level = 'L2')`,
      )
      .run(
        params.approvedBy,
        params.approverId,
        params.nonceHash,
        params.approvedAt,
        params.id,
        params.approvedAt,
        params.approvedBy,
      )
    return result.changes > 0 ? this.get(params.id) : null
  }

  consume(params: {
    id: string
    nonceHash: string
    actionDigest: string
    targetDigest: string
    dataClassDigest: string | null
    usedAt: string
  }): boolean {
    const result = this.raw
      .prepare(
        `UPDATE computer_approvals
         SET used_at = ?
         WHERE id = ?
           AND decision = 'approved'
           AND used_at IS NULL
           AND approved_at <= ?
           AND expires_at > ?
           AND nonce_hash = ?
           AND action_digest = ?
           AND target_digest = ?
           AND data_class_digest IS ?`,
      )
      .run(
        params.usedAt,
        params.id,
        params.usedAt,
        params.usedAt,
        params.nonceHash,
        params.actionDigest,
        params.targetDigest,
        params.dataClassDigest,
      )
    return result.changes === 1
  }

  denyPendingForSession(computerSessionId: string, deniedAt: string): number {
    const result = this.raw
      .prepare(
        `UPDATE computer_approvals
         SET decision = 'denied'
         WHERE computer_session_id = ?
           AND (decision = 'pending' OR (decision = 'approved' AND used_at IS NULL))
           AND created_at <= ?`,
      )
      .run(computerSessionId, deniedAt)
    return result.changes
  }

  deny(id: string, computerSessionId: string, deniedAt: string): boolean {
    const result = this.raw
      .prepare(
        `UPDATE computer_approvals
         SET decision = 'denied'
         WHERE id = ?
           AND computer_session_id = ?
           AND decision = 'pending'
           AND created_at <= ?`,
      )
      .run(id, computerSessionId, deniedAt)
    return result.changes === 1
  }

  private require(id: string): ComputerApprovalRow {
    const row = this.get(id)
    if (row == null) throw new Error(`Computer approval ${id} was not persisted`)
    return row
  }
}
