import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface ComputerVerificationRow {
  id: string
  computer_session_id: string
  spec_json: string
  status: 'pending' | 'passed' | 'failed' | 'inconclusive'
  evidence_json: string
  confidence: number | null
  verifier_model_id: string | null
  created_at: string
  completed_at: string | null
}

export class ComputerVerificationRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'computer_verifications')
  }

  create(params: {
    id: string
    computerSessionId: string
    spec: Record<string, unknown>
    verifierModelId: string | null
    createdAt: string
  }): ComputerVerificationRow {
    this.raw
      .prepare(
        `INSERT INTO computer_verifications (
           id, computer_session_id, spec_json, status, evidence_json, confidence,
           verifier_model_id, created_at, completed_at
         ) VALUES (?, ?, ?, 'pending', '[]', NULL, ?, ?, NULL)`,
      )
      .run(
        params.id,
        params.computerSessionId,
        this.toJson(params.spec),
        params.verifierModelId,
        params.createdAt,
      )
    return this.require(params.id)
  }

  get(id: string): ComputerVerificationRow | null {
    return this.findById<ComputerVerificationRow>(id)
  }

  complete(
    id: string,
    params: {
      status: Exclude<ComputerVerificationRow['status'], 'pending'>
      evidence: unknown[]
      confidence: number | null
      completedAt: string
    },
  ): ComputerVerificationRow | null {
    const result = this.raw
      .prepare(
        `UPDATE computer_verifications
         SET status = ?, evidence_json = ?, confidence = ?, completed_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(params.status, this.toJson(params.evidence), params.confidence, params.completedAt, id)
    return result.changes > 0 ? this.get(id) : null
  }

  private require(id: string): ComputerVerificationRow {
    const row = this.get(id)
    if (row == null) throw new Error(`Computer verification ${id} was not persisted`)
    return row
  }
}
