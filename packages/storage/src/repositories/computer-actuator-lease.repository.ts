import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface ComputerActuatorLeaseRow {
  id: string
  environment_key: string
  computer_session_id: string
  operator_id: string
  acquired_at: string
  heartbeat_at: string
  expires_at: string
  released_at: string | null
}

export class ComputerActuatorLeaseRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'computer_actuator_leases')
  }

  acquire(params: {
    id: string
    environmentKey: string
    computerSessionId: string
    operatorId: string
    acquiredAt: string
    expiresAt: string
  }): ComputerActuatorLeaseRow {
    const transaction = this.raw.transaction(() => {
      this.raw
        .prepare(
          `UPDATE computer_sessions
           SET actuator_lease_id = NULL, updated_at = ?
           WHERE actuator_lease_id IN (
             SELECT leases.id
             FROM computer_actuator_leases AS leases
             LEFT JOIN computer_sessions AS sessions
               ON sessions.id = leases.computer_session_id
             WHERE leases.released_at IS NULL
               AND (
                 leases.expires_at <= ?
                 OR sessions.status IN ('completed', 'failed', 'canceled')
               )
           )`,
        )
        .run(params.acquiredAt, params.acquiredAt)
      this.raw
        .prepare(
          `UPDATE computer_actuator_leases
           SET released_at = ?
           WHERE released_at IS NULL
             AND (
               expires_at <= ?
               OR computer_session_id IN (
                 SELECT id FROM computer_sessions
                 WHERE status IN ('completed', 'failed', 'canceled')
               )
             )`,
        )
        .run(params.acquiredAt, params.acquiredAt)
      this.raw
        .prepare(
          `INSERT INTO computer_actuator_leases (
             id, environment_key, computer_session_id, operator_id,
             acquired_at, heartbeat_at, expires_at, released_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          params.id,
          params.environmentKey,
          params.computerSessionId,
          params.operatorId,
          params.acquiredAt,
          params.acquiredAt,
          params.expiresAt,
        )
      this.raw
        .prepare('UPDATE computer_sessions SET actuator_lease_id = ?, updated_at = ? WHERE id = ?')
        .run(params.id, params.acquiredAt, params.computerSessionId)
      const row = this.get(params.id)
      if (row == null) throw new Error(`Computer actuator lease ${params.id} was not persisted`)
      return row
    })
    return transaction()
  }

  get(id: string): ComputerActuatorLeaseRow | null {
    return this.findById<ComputerActuatorLeaseRow>(id)
  }

  heartbeat(
    id: string,
    operatorId: string,
    heartbeatAt: string,
    expiresAt: string,
  ): ComputerActuatorLeaseRow | null {
    const result = this.raw
      .prepare(
        `UPDATE computer_actuator_leases
         SET heartbeat_at = ?, expires_at = ?
         WHERE id = ? AND operator_id = ? AND released_at IS NULL AND expires_at > ?`,
      )
      .run(heartbeatAt, expiresAt, id, operatorId, heartbeatAt)
    return result.changes > 0 ? this.get(id) : null
  }

  release(id: string, operatorId: string, releasedAt: string): boolean {
    const transaction = this.raw.transaction(() => {
      const row = this.get(id)
      if (row == null || row.operator_id !== operatorId || row.released_at !== null) return false
      const result = this.raw
        .prepare(
          `UPDATE computer_actuator_leases SET released_at = ?
           WHERE id = ? AND operator_id = ? AND released_at IS NULL`,
        )
        .run(releasedAt, id, operatorId)
      if (result.changes === 0) return false
      this.raw
        .prepare(
          `UPDATE computer_sessions
           SET actuator_lease_id = NULL, updated_at = ?
           WHERE id = ? AND actuator_lease_id = ?`,
        )
        .run(releasedAt, row.computer_session_id, id)
      return true
    })
    return transaction()
  }
}
