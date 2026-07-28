import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type StoredComputerActionStatus =
  | 'requested'
  | 'blocked'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'canceled'

export interface ComputerActionRow {
  id: string
  computer_session_id: string
  step_index: number
  action_json: string
  intent: string
  risk_level: 'L0' | 'L1' | 'L2' | 'L3' | 'L4'
  policy_decision: 'allow' | 'require_approval' | 'require_handoff' | 'deny'
  approval_ticket_id: string | null
  before_frame_id: string
  after_frame_id: string | null
  expected_postcondition_json: string | null
  status: StoredComputerActionStatus
  error_code: string | null
  created_at: string
  completed_at: string | null
}

export interface CreateComputerActionParams {
  id: string
  computerSessionId: string
  stepIndex: number
  action: Record<string, unknown>
  intent: string
  riskLevel: ComputerActionRow['risk_level']
  policyDecision: ComputerActionRow['policy_decision']
  approvalTicketId: string | null
  beforeFrameId: string
  expectedPostcondition: Record<string, unknown> | null
  createdAt: string
}

export class ComputerActionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'computer_actions')
  }

  create(params: CreateComputerActionParams): ComputerActionRow {
    this.raw
      .prepare(
        `INSERT INTO computer_actions (
           id, computer_session_id, step_index, action_json, intent, risk_level,
           policy_decision, approval_ticket_id, before_frame_id, after_frame_id,
           expected_postcondition_json, status, error_code, created_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'requested', NULL, ?, NULL)`,
      )
      .run(
        params.id,
        params.computerSessionId,
        params.stepIndex,
        this.toJson(params.action),
        params.intent,
        params.riskLevel,
        params.policyDecision,
        params.approvalTicketId,
        params.beforeFrameId,
        params.expectedPostcondition == null ? null : this.toJson(params.expectedPostcondition),
        params.createdAt,
      )
    return this.require(params.id)
  }

  get(id: string): ComputerActionRow | null {
    return this.findById<ComputerActionRow>(id)
  }

  nextStepIndex(computerSessionId: string): number {
    const row = this.raw
      .prepare(
        `SELECT COALESCE(MAX(step_index) + 1, 0) AS next_step_index
         FROM computer_actions
         WHERE computer_session_id = ?`,
      )
      .get(computerSessionId) as { next_step_index: number }
    return row.next_step_index
  }

  startExecuting(id: string, approvalTicketId: string | null): ComputerActionRow | null {
    const result = this.raw
      .prepare(
        `UPDATE computer_actions
         SET status = 'executing', approval_ticket_id = ?
         WHERE id = ?
           AND status = 'requested'
           AND (
             (policy_decision = 'allow' AND ? IS NULL)
             OR (
               policy_decision = 'require_approval'
               AND ? IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM computer_approvals
                 WHERE computer_approvals.id = ?
                   AND computer_approvals.action_id = computer_actions.id
                   AND computer_approvals.decision = 'approved'
                   AND computer_approvals.used_at IS NOT NULL
               )
             )
           )`,
      )
      .run(approvalTicketId, id, approvalTicketId, approvalTicketId, approvalTicketId)
    return result.changes > 0 ? this.get(id) : null
  }

  complete(
    id: string,
    params: {
      status: Exclude<StoredComputerActionStatus, 'requested' | 'executing'>
      afterFrameId: string | null
      errorCode: string | null
      completedAt: string
    },
  ): ComputerActionRow | null {
    const result = this.raw
      .prepare(
        `UPDATE computer_actions
         SET status = ?, after_frame_id = ?, error_code = ?, completed_at = ?
         WHERE id = ? AND status IN ('requested', 'executing')`,
      )
      .run(params.status, params.afterFrameId, params.errorCode, params.completedAt, id)
    return result.changes > 0 ? this.get(id) : null
  }

  private require(id: string): ComputerActionRow {
    const row = this.get(id)
    if (row == null) throw new Error(`Computer action ${id} was not persisted`)
    return row
  }
}
