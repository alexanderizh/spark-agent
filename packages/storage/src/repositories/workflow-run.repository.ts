import { randomUUID } from 'crypto'
import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type WorkflowRunStatus = 'working' | 'completed' | 'failed' | 'canceled'

export interface WorkflowRunRow {
  id: string
  session_id: string
  turn_id: string
  workflow_id: string
  status: WorkflowRunStatus
  objective: string
  graph_json: string
  state_json: string
  executions_json: string
  atomic_executions_json: string
  completed_node_ids_json: string
  failed_node_json: string | null
  started_at: string
  updated_at: string
  ended_at: string | null
}

export interface CreateWorkflowRunParams {
  id?: string
  sessionId: string
  turnId: string
  workflowId: string
  objective: string
  graph: Record<string, unknown>
}

export interface UpdateWorkflowRunSnapshotParams {
  status: WorkflowRunStatus
  state: Record<string, unknown>
  executions: unknown[]
  atomicExecutions: unknown[]
  completedNodeIds: string[]
  failedNode?: unknown
  endedAt?: string | null
}

export class WorkflowRunRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'workflow_runs')
  }

  create(params: CreateWorkflowRunParams): WorkflowRunRow {
    const id = params.id ?? randomUUID()
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO workflow_runs (
          id, session_id, turn_id, workflow_id, status, objective, graph_json,
          state_json, executions_json, atomic_executions_json, completed_node_ids_json,
          started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.sessionId,
        params.turnId,
        params.workflowId,
        'working',
        params.objective,
        this.toJson(params.graph),
        '{}',
        '[]',
        '[]',
        '[]',
        now,
        now,
      )
    return this.get(id)!
  }

  get(id: string): WorkflowRunRow | null {
    return this.findById<WorkflowRunRow>(id)
  }

  updateSnapshot(id: string, params: UpdateWorkflowRunSnapshotParams): WorkflowRunRow | null {
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `UPDATE workflow_runs
         SET status = ?,
             state_json = ?,
             executions_json = ?,
             atomic_executions_json = ?,
             completed_node_ids_json = ?,
             failed_node_json = ?,
             updated_at = ?,
             ended_at = ?
         WHERE id = ?`,
      )
      .run(
        params.status,
        this.toJson(params.state),
        this.toJson(params.executions),
        this.toJson(params.atomicExecutions),
        this.toJson(params.completedNodeIds),
        params.failedNode === undefined ? null : this.toJson(params.failedNode),
        now,
        params.endedAt ?? null,
        id,
      )
    return this.get(id)
  }

  findLatestResumable(sessionId: string, workflowId: string): WorkflowRunRow | null {
    const row = this.raw
      .prepare(
        `SELECT *
         FROM workflow_runs
         WHERE session_id = ?
           AND workflow_id = ?
           AND status IN ('working','failed')
         ORDER BY updated_at DESC, started_at DESC
         LIMIT 1`,
      )
      .get(sessionId, workflowId) as WorkflowRunRow | undefined
    return row ?? null
  }

  listBySession(sessionId: string, limit = 50): WorkflowRunRow[] {
    return this.raw
      .prepare('SELECT * FROM workflow_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(sessionId, limit) as WorkflowRunRow[]
  }

  markStaleAsFailed(olderThanIso: string): number {
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `UPDATE workflow_runs
         SET status = 'failed',
             updated_at = ?,
             ended_at = COALESCE(ended_at, ?),
             failed_node_json = COALESCE(failed_node_json, ?)
         WHERE status = 'working' AND ended_at IS NULL AND started_at < ?`,
      )
      .run(
        now,
        now,
        this.toJson({ nodeId: 'workflow', agentId: 'workflow', attempt: 1, error: { code: 'stale_run', message: 'Workflow run abandoned before completion.' } }),
        olderThanIso,
      )
    return result.changes
  }
}
