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
  skipped_node_ids_json: string
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

/** listByWorkflow 的轻量行：不含 graph_json/state_json/executions_json/atomic_executions_json。 */
export interface WorkflowRunSummaryRow {
  id: string
  session_id: string
  turn_id: string
  workflow_id: string
  status: WorkflowRunStatus
  objective: string
  completed_node_ids_json: string
  skipped_node_ids_json: string
  failed_node_json: string | null
  started_at: string
  updated_at: string
  ended_at: string | null
}

export interface UpdateWorkflowRunSnapshotParams {
  status: WorkflowRunStatus
  state: Record<string, unknown>
  executions: unknown[]
  atomicExecutions: unknown[]
  completedNodeIds: string[]
  skippedNodeIds?: string[]
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
          skipped_node_ids_json,
          started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
             skipped_node_ids_json = ?,
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
        this.toJson(params.skippedNodeIds ?? []),
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

  /**
   * 按工作流查历史运行（工作流编辑器「运行历史」入口）。
   *
   * 只取轻量列：graph/state/executions/atomic_executions 四个大 JSON 不进列表查询，
   * 详情按 runId 单查 get()。completed/skipped/failed 三个小 JSON 保留用于列表计数。
   * rowid 决胜：同毫秒创建的多条运行按插入顺序倒排，排序稳定。
   */
  listByWorkflow(workflowId: string, limit = 30): WorkflowRunSummaryRow[] {
    return this.raw
      .prepare(
        `SELECT id, session_id, turn_id, workflow_id, status, objective,
                completed_node_ids_json, skipped_node_ids_json, failed_node_json,
                started_at, updated_at, ended_at
         FROM workflow_runs
         WHERE workflow_id = ?
         ORDER BY started_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(workflowId, limit) as WorkflowRunSummaryRow[]
  }

  /**
   * 查找指定工作流当前仍在运行的记录。
   *
   * 不能通过 listByWorkflow 的历史分页间接判断：大量较新的终态记录可能把一条较早的
   * working 记录挤出 limit，导致调用方误以为可以重复启动。
   */
  findWorkingByWorkflow(workflowId: string): WorkflowRunSummaryRow | null {
    const row = this.raw
      .prepare(
        `SELECT id, session_id, turn_id, workflow_id, status, objective,
                completed_node_ids_json, skipped_node_ids_json, failed_node_json,
                started_at, updated_at, ended_at
         FROM workflow_runs
         WHERE workflow_id = ? AND status = 'working'
         ORDER BY started_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(workflowId) as WorkflowRunSummaryRow | undefined
    return row ?? null
  }

  /**
   * Delete all workflow runs for a given session.
   *
   * 三轮功能逻辑审查修复：deleteSession 时清理 workflow_runs（之前漏清）。
   * workflow_runs 存的是 workflow 在 session 内的执行历史，与 session 强关联。
   * 删除 session 不应影响 workflow 表（workflow 定义本身保留）。
   */
  deleteBySession(sessionId: string): number {
    const result = this.raw.prepare('DELETE FROM workflow_runs WHERE session_id = ?').run(sessionId)
    return result.changes
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
        this.toJson({
          nodeId: 'workflow',
          agentId: 'workflow',
          attempt: 1,
          error: { code: 'stale_run', message: 'Workflow run abandoned before completion.' },
        }),
        olderThanIso,
      )
    return result.changes
  }
}
