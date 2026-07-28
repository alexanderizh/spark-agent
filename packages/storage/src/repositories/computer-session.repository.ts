import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type StoredComputerEnvironment = 'safe_browser' | 'safe_desktop' | 'my_desktop'
export type StoredComputerSessionStatus =
  | 'preflighting'
  | 'observing'
  | 'planning'
  | 'waiting_approval'
  | 'acting'
  | 'verifying'
  | 'paused'
  | 'handoff_required'
  | 'completed'
  | 'failed'
  | 'canceled'

export interface ComputerSessionRow {
  id: string
  session_id: string
  turn_id: string
  workflow_run_id: string | null
  environment: StoredComputerEnvironment
  status: StoredComputerSessionStatus
  provider_profile_id: string
  model_id: string
  task_contract_json: string
  actuator_lease_id: string | null
  created_at: string
  updated_at: string
  ended_at: string | null
}

export interface CreateComputerSessionParams {
  id: string
  sessionId: string
  turnId: string
  workflowRunId: string | null
  environment: StoredComputerEnvironment
  providerProfileId: string
  modelId: string
  taskContract: Record<string, unknown>
  createdAt: string
}

export class ComputerSessionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'computer_sessions')
  }

  create(params: CreateComputerSessionParams): ComputerSessionRow {
    this.raw
      .prepare(
        `INSERT INTO computer_sessions (
           id, session_id, turn_id, workflow_run_id, environment, status,
           provider_profile_id, model_id, task_contract_json, actuator_lease_id,
           created_at, updated_at, ended_at
         ) VALUES (?, ?, ?, ?, ?, 'preflighting', ?, ?, ?, NULL, ?, ?, NULL)`,
      )
      .run(
        params.id,
        params.sessionId,
        params.turnId,
        params.workflowRunId,
        params.environment,
        params.providerProfileId,
        params.modelId,
        this.toJson(params.taskContract),
        params.createdAt,
        params.createdAt,
      )
    return this.require(params.id)
  }

  get(id: string): ComputerSessionRow | null {
    return this.findById<ComputerSessionRow>(id)
  }

  listActive(limit = 10_000): ComputerSessionRow[] {
    const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 10_000
    const boundedLimit = Math.max(1, Math.min(10_000, requestedLimit))
    return this.raw
      .prepare(
        `SELECT * FROM computer_sessions
         WHERE status NOT IN ('completed', 'failed', 'canceled')
         ORDER BY created_at ASC
         LIMIT ?`,
      )
      .all(boundedLimit) as ComputerSessionRow[]
  }

  updateStatus(
    id: string,
    status: StoredComputerSessionStatus,
    updatedAt: string,
    endedAt: string | null = null,
  ): ComputerSessionRow | null {
    this.raw
      .prepare(
        `UPDATE computer_sessions
         SET status = ?, updated_at = ?, ended_at = ?
         WHERE id = ?`,
      )
      .run(status, updatedAt, endedAt, id)
    return this.get(id)
  }

  listBySession(sessionId: string, limit = 100): ComputerSessionRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM computer_sessions
         WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(sessionId, limit) as ComputerSessionRow[]
  }

  private require(id: string): ComputerSessionRow {
    const row = this.get(id)
    if (row == null) throw new Error(`Computer session ${id} was not persisted`)
    return row
  }
}
