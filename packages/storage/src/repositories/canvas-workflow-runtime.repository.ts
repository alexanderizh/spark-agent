import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export interface CanvasWorkflowVersionRow {
  workflow_id: string
  version: number
  name: string
  package_json: string
  created_by_user_id: number
  created_at: string
}

export interface CreateCanvasWorkflowVersionParams<TPackage = unknown> {
  workflowId: string
  version: number
  name: string
  packageJson: TPackage
  createdByUserId?: number
  createdAt?: string
}

export type CanvasWorkflowRunStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type CanvasWorkflowRunStepStatus =
  | 'blocked'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped'

export interface CanvasWorkflowRunRow {
  id: string
  workflow_id: string
  workflow_version: number
  project_id: string
  user_id: number
  status: CanvasWorkflowRunStatus
  inputs_json: string
  exposed_params_json: string
  outputs_json: string
  error_json: string | null
  idempotency_key: string
  created_at: string
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

export interface CanvasWorkflowRunStepRow {
  id: string
  run_id: string
  node_id: string
  step_index: number
  status: CanvasWorkflowRunStepStatus
  depends_on_json: string
  task_id: string | null
  input_json: string
  output_json: string | null
  error_json: string | null
  attempt: number
  started_at: string | null
  finished_at: string | null
  updated_at: string
}

export interface CreateCanvasWorkflowRunParams {
  id: string
  workflowId: string
  workflowVersion: number
  projectId: string
  userId?: number
  inputsJson: Record<string, unknown>
  exposedParamsJson: Record<string, unknown>
  idempotencyKey: string
  createdAt?: string
}

export interface CreateCanvasWorkflowRunStepParams {
  id: string
  nodeId: string
  stepIndex: number
  dependsOnNodeIds: string[]
}

export interface ListCanvasWorkflowRunsParams {
  projectId?: string
  workflowId?: string
  status?: CanvasWorkflowRunStatus
  limit?: number
  offset?: number
}

export interface UpdateCanvasWorkflowRunParams {
  status?: CanvasWorkflowRunStatus
  outputsJson?: Record<string, unknown>
  errorJson?: Record<string, unknown> | null
  startedAt?: string | null
  finishedAt?: string | null
  updatedAt?: string
}

export interface UpdateCanvasWorkflowRunStepParams {
  status?: CanvasWorkflowRunStepStatus
  taskId?: string | null
  inputJson?: Record<string, unknown>
  outputJson?: Record<string, unknown> | null
  errorJson?: Record<string, unknown> | null
  startedAt?: string | null
  finishedAt?: string | null
  updatedAt?: string
}

export class CanvasWorkflowVersionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'canvas_workflow_versions')
  }

  create<TPackage>(params: CreateCanvasWorkflowVersionParams<TPackage>): CanvasWorkflowVersionRow {
    this.raw
      .prepare(
        `INSERT INTO canvas_workflow_versions (
          workflow_id, version, name, package_json, created_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        params.workflowId,
        params.version,
        params.name,
        this.toJson(params.packageJson),
        params.createdByUserId ?? 0,
        params.createdAt ?? new Date().toISOString(),
      )
    return this.get(params.workflowId, params.version)!
  }

  get(workflowId: string, version: number): CanvasWorkflowVersionRow | null {
    const row = this.raw
      .prepare('SELECT * FROM canvas_workflow_versions WHERE workflow_id = ? AND version = ?')
      .get(workflowId, version) as CanvasWorkflowVersionRow | undefined
    return row ?? null
  }

  list(workflowId: string, limit = 100, offset = 0): CanvasWorkflowVersionRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM canvas_workflow_versions
         WHERE workflow_id = ? ORDER BY version DESC LIMIT ? OFFSET ?`,
      )
      .all(workflowId, limit, offset) as CanvasWorkflowVersionRow[]
  }
}

export class CanvasWorkflowRunRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'canvas_workflow_runs')
  }

  withTransaction<T>(work: () => T): T {
    return this.raw.transaction(work)()
  }

  create(params: CreateCanvasWorkflowRunParams): CanvasWorkflowRunRow {
    const existing = this.getByIdempotencyKey(params.idempotencyKey)
    if (existing) return existing
    const now = params.createdAt ?? new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO canvas_workflow_runs (
          id, workflow_id, workflow_version, project_id, user_id, status,
          inputs_json, exposed_params_json, outputs_json, idempotency_key,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, '{}', ?, ?, ?)`,
      )
      .run(
        params.id,
        params.workflowId,
        params.workflowVersion,
        params.projectId,
        params.userId ?? 0,
        this.toJson(params.inputsJson),
        this.toJson(params.exposedParamsJson),
        params.idempotencyKey,
        now,
        now,
      )
    return this.get(params.id)!
  }

  get(id: string): CanvasWorkflowRunRow | null {
    return this.findById<CanvasWorkflowRunRow>(id)
  }

  getByIdempotencyKey(key: string): CanvasWorkflowRunRow | null {
    const row = this.raw
      .prepare('SELECT * FROM canvas_workflow_runs WHERE idempotency_key = ?')
      .get(key) as CanvasWorkflowRunRow | undefined
    return row ?? null
  }

  list(params: ListCanvasWorkflowRunsParams = {}): CanvasWorkflowRunRow[] {
    const clauses: string[] = []
    const values: Array<string | number> = []
    if (params.projectId) {
      clauses.push('project_id = ?')
      values.push(params.projectId)
    }
    if (params.workflowId) {
      clauses.push('workflow_id = ?')
      values.push(params.workflowId)
    }
    if (params.status) {
      clauses.push('status = ?')
      values.push(params.status)
    }
    values.push(Math.min(Math.max(params.limit ?? 50, 1), 200), Math.max(params.offset ?? 0, 0))
    return this.raw
      .prepare(
        `SELECT * FROM canvas_workflow_runs
         ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...values) as CanvasWorkflowRunRow[]
  }

  hasRunsForWorkflow(workflowId: string): boolean {
    const row = this.raw
      .prepare(
        `SELECT EXISTS(
          SELECT 1 FROM canvas_workflow_runs WHERE workflow_id = ? LIMIT 1
        ) AS has_runs`,
      )
      .get(workflowId) as { has_runs: number }
    return row.has_runs === 1
  }

  createSteps(runId: string, steps: CreateCanvasWorkflowRunStepParams[]): void {
    const now = new Date().toISOString()
    const insert = this.raw.prepare(
      `INSERT INTO canvas_workflow_run_steps (
        id, run_id, node_id, step_index, status, depends_on_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const transaction = this.raw.transaction(() => {
      for (const step of steps) {
        insert.run(
          step.id,
          runId,
          step.nodeId,
          step.stepIndex,
          step.dependsOnNodeIds.length === 0 ? 'ready' : 'blocked',
          this.toJson(step.dependsOnNodeIds),
          now,
        )
      }
    })
    transaction()
  }

  getStep(runId: string, nodeId: string): CanvasWorkflowRunStepRow | null {
    const row = this.raw
      .prepare('SELECT * FROM canvas_workflow_run_steps WHERE run_id = ? AND node_id = ?')
      .get(runId, nodeId) as CanvasWorkflowRunStepRow | undefined
    return row ?? null
  }

  listSteps(runId: string): CanvasWorkflowRunStepRow[] {
    return this.raw
      .prepare('SELECT * FROM canvas_workflow_run_steps WHERE run_id = ? ORDER BY step_index')
      .all(runId) as CanvasWorkflowRunStepRow[]
  }

  updateRun(id: string, patch: UpdateCanvasWorkflowRunParams): CanvasWorkflowRunRow | null {
    const current = this.get(id)
    if (!current) return null
    this.raw
      .prepare(
        `UPDATE canvas_workflow_runs SET
          status = ?, outputs_json = ?, error_json = ?, started_at = ?, finished_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status ?? current.status,
        patch.outputsJson !== undefined ? this.toJson(patch.outputsJson) : current.outputs_json,
        patch.errorJson !== undefined
          ? patch.errorJson === null
            ? null
            : this.toJson(patch.errorJson)
          : current.error_json,
        patch.startedAt !== undefined ? patch.startedAt : current.started_at,
        patch.finishedAt !== undefined ? patch.finishedAt : current.finished_at,
        patch.updatedAt ?? new Date().toISOString(),
        id,
      )
    return this.get(id)
  }

  updateStep(
    runId: string,
    nodeId: string,
    patch: UpdateCanvasWorkflowRunStepParams,
  ): CanvasWorkflowRunStepRow | null {
    const current = this.getStep(runId, nodeId)
    if (!current) return null
    this.raw
      .prepare(
        `UPDATE canvas_workflow_run_steps SET
          status = ?, task_id = ?, input_json = ?, output_json = ?, error_json = ?,
          started_at = ?, finished_at = ?, updated_at = ?
         WHERE run_id = ? AND node_id = ?`,
      )
      .run(
        patch.status ?? current.status,
        patch.taskId !== undefined ? patch.taskId : current.task_id,
        patch.inputJson !== undefined ? this.toJson(patch.inputJson) : current.input_json,
        patch.outputJson !== undefined
          ? patch.outputJson === null
            ? null
            : this.toJson(patch.outputJson)
          : current.output_json,
        patch.errorJson !== undefined
          ? patch.errorJson === null
            ? null
            : this.toJson(patch.errorJson)
          : current.error_json,
        patch.startedAt !== undefined ? patch.startedAt : current.started_at,
        patch.finishedAt !== undefined ? patch.finishedAt : current.finished_at,
        patch.updatedAt ?? new Date().toISOString(),
        runId,
        nodeId,
      )
    return this.getStep(runId, nodeId)
  }

  retryFailedStep(
    runId: string,
    nodeId: string,
    updatedAt = new Date().toISOString(),
  ): CanvasWorkflowRunStepRow | null {
    const current = this.getStep(runId, nodeId)
    if (!current || current.status !== 'failed') return null
    this.raw
      .prepare(
        `UPDATE canvas_workflow_run_steps SET
          status = 'ready', attempt = attempt + 1, task_id = NULL, error_json = NULL,
          started_at = NULL, finished_at = NULL, updated_at = ?
         WHERE run_id = ? AND node_id = ? AND status = 'failed'`,
      )
      .run(updatedAt, runId, nodeId)
    this.updateRun(runId, {
      status: 'running',
      errorJson: null,
      finishedAt: null,
      updatedAt,
    })
    return this.getStep(runId, nodeId)
  }

  releaseReadySteps(runId: string, updatedAt = new Date().toISOString()): string[] {
    const steps = this.listSteps(runId)
    const satisfiedNodeIds = new Set(
      steps
        .filter((step) => step.status === 'completed' || step.status === 'skipped')
        .map((step) => step.node_id),
    )
    const released: string[] = []
    const update = this.raw.prepare(
      `UPDATE canvas_workflow_run_steps
       SET status = 'ready', updated_at = ?
       WHERE id = ? AND status = 'blocked'`,
    )
    const transaction = this.raw.transaction(() => {
      for (const step of steps) {
        if (step.status !== 'blocked') continue
        const dependencies = this.fromJson<string[]>(step.depends_on_json, [])
        if (!dependencies.every((nodeId) => satisfiedNodeIds.has(nodeId))) continue
        const result = update.run(updatedAt, step.id)
        if (result.changes > 0) released.push(step.node_id)
      }
    })
    transaction()
    return released
  }

  reconcileStatus(
    runId: string,
    updatedAt = new Date().toISOString(),
  ): CanvasWorkflowRunRow | null {
    const run = this.get(runId)
    if (!run || run.status === 'cancelled') return run
    const steps = this.listSteps(runId)
    if (steps.some((step) => step.status === 'failed')) {
      const failed = steps.find((step) => step.status === 'failed')!
      return this.updateRun(runId, {
        status: 'failed',
        errorJson: this.fromJson<Record<string, unknown>>(failed.error_json, {
          code: 'step_failed',
          nodeId: failed.node_id,
        }),
        finishedAt: updatedAt,
        updatedAt,
      })
    }
    if (
      steps.length > 0 &&
      steps.every((step) => step.status === 'completed' || step.status === 'skipped')
    ) {
      return this.updateRun(runId, {
        status: 'completed',
        errorJson: null,
        finishedAt: updatedAt,
        updatedAt,
      })
    }
    if (steps.some((step) => step.status === 'ready' || step.status === 'running')) {
      return this.updateRun(runId, {
        status: 'running',
        startedAt: run.started_at ?? updatedAt,
        finishedAt: null,
        updatedAt,
      })
    }
    return run
  }

  cancel(id: string, updatedAt = new Date().toISOString()): CanvasWorkflowRunRow | null {
    const current = this.get(id)
    if (!current || current.status === 'completed') return current
    const transaction = this.raw.transaction(() => {
      this.raw
        .prepare(
          `UPDATE canvas_workflow_run_steps
           SET status = 'cancelled', finished_at = ?, updated_at = ?
           WHERE run_id = ? AND status IN ('blocked', 'ready', 'running', 'failed')`,
        )
        .run(updatedAt, updatedAt, id)
      this.updateRun(id, { status: 'cancelled', finishedAt: updatedAt, updatedAt })
    })
    transaction()
    return this.get(id)
  }

  resume(id: string, updatedAt = new Date().toISOString()): CanvasWorkflowRunRow | null {
    const current = this.get(id)
    if (!current || !['failed', 'paused', 'cancelled'].includes(current.status)) return null
    const transaction = this.raw.transaction(() => {
      const steps = this.listSteps(id)
      const completedNodeIds = new Set(
        steps.filter((step) => step.status === 'completed').map((step) => step.node_id),
      )
      for (const step of steps) {
        if (!['failed', 'cancelled'].includes(step.status)) continue
        const dependencies = this.fromJson<string[]>(step.depends_on_json, [])
        const status: CanvasWorkflowRunStepStatus = dependencies.every((nodeId) =>
          completedNodeIds.has(nodeId),
        )
          ? 'ready'
          : 'blocked'
        this.raw
          .prepare(
            `UPDATE canvas_workflow_run_steps SET
              status = ?, attempt = attempt + 1, task_id = NULL, error_json = NULL, started_at = NULL,
              finished_at = NULL, updated_at = ? WHERE id = ?`,
          )
          .run(status, updatedAt, step.id)
      }
      this.updateRun(id, {
        status: 'running',
        errorJson: null,
        finishedAt: null,
        startedAt: current.started_at ?? updatedAt,
        updatedAt,
      })
    })
    transaction()
    return this.get(id)
  }
}
