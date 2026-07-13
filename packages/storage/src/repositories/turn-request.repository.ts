import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type TurnRequestStatus = 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface TurnRequestRow {
  id: string
  session_id: string
  payload_json: string
  status: TurnRequestStatus
  error_message: string | null
  created_at: string
  updated_at: string
}

export class TurnRequestRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'turn_requests')
  }

  create(params: { id: string; sessionId: string; payloadJson: string; createdAt: string }): void {
    this.raw
      .prepare(
        `
      INSERT INTO turn_requests (
        id, session_id, payload_json, status, error_message, created_at, updated_at
      ) VALUES (?, ?, ?, 'accepted', NULL, ?, ?)
    `,
      )
      .run(params.id, params.sessionId, params.payloadJson, params.createdAt, params.createdAt)
  }

  get(id: string): TurnRequestRow | null {
    return this.findById<TurnRequestRow>(id)
  }

  listRecoverable(): TurnRequestRow[] {
    return this.raw
      .prepare(
        `
      SELECT * FROM turn_requests
      WHERE status IN ('accepted', 'running')
      ORDER BY created_at ASC, id ASC
    `,
      )
      .all() as TurnRequestRow[]
  }

  markRunning(id: string): boolean {
    return this.updateStatus(id, 'running', ['accepted'])
  }

  resetAccepted(id: string): boolean {
    return this.updateStatus(id, 'accepted', ['running'])
  }

  markCompleted(id: string): boolean {
    return this.updateStatus(id, 'completed', ['accepted', 'running'])
  }

  markFailed(id: string, errorMessage: string): boolean {
    const result = this.raw
      .prepare(
        `
      UPDATE turn_requests
      SET status = 'failed', payload_json = '{}', error_message = ?, updated_at = ?
      WHERE id = ? AND status IN ('accepted', 'running')
    `,
      )
      .run(errorMessage, new Date().toISOString(), id)
    return result.changes > 0
  }

  cancel(id: string): boolean {
    return this.updateStatus(id, 'cancelled', ['accepted', 'running'])
  }

  deleteTerminalBeforeBatch(beforeIso: string, batchSize: number = 1000): number {
    const safeBatchSize = Math.max(1, Math.min(5000, Math.floor(batchSize)))
    const rows = this.raw
      .prepare(
        `
        SELECT rowid
        FROM turn_requests
        WHERE status IN ('completed', 'failed', 'cancelled')
          AND updated_at < ?
        ORDER BY updated_at ASC
        LIMIT ?
      `,
      )
      .all(beforeIso, safeBatchSize) as Array<{ rowid: number }>
    if (rows.length === 0) return 0
    const placeholders = rows.map(() => '?').join(',')
    const result = this.raw
      .prepare(`DELETE FROM turn_requests WHERE rowid IN (${placeholders})`)
      .run(...rows.map((row) => row.rowid))
    return result.changes
  }

  private updateStatus(id: string, status: TurnRequestStatus, from: TurnRequestStatus[]): boolean {
    const placeholders = from.map(() => '?').join(',')
    const clearPayload =
      status === 'completed' || status === 'failed' || status === 'cancelled'
        ? ", payload_json = '{}'"
        : ''
    const result = this.raw
      .prepare(
        `
      UPDATE turn_requests
      SET status = ?, error_message = NULL${clearPayload}, updated_at = ?
      WHERE id = ? AND status IN (${placeholders})
    `,
      )
      .run(status, new Date().toISOString(), id, ...from)
    return result.changes > 0
  }
}
