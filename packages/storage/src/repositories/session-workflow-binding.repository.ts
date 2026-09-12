import { randomUUID } from 'node:crypto'
import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export type SessionWorkflowBindingMode = 'inherit' | 'override' | 'disabled'

export interface SessionWorkflowBindingRow {
  session_id: string
  binding_instance_id: string
  mode: SessionWorkflowBindingMode
  workflow_id: string | null
  created_at: string
  updated_at: string
}

export interface SessionWorkflowBinding {
  sessionId: string
  bindingInstanceId: string
  mode: SessionWorkflowBindingMode
  workflowId: string | null
  createdAt: string
  updatedAt: string
}

export interface SetSessionWorkflowBindingParams {
  sessionId: string
  mode: SessionWorkflowBindingMode
  workflowId?: string | null
  expectedBindingInstanceId?: string | null
}

export interface SetSessionWorkflowBindingResult {
  binding: SessionWorkflowBinding
  changed: boolean
}

/** Stable optimistic-concurrency error used by IPC and non-UI callers. */
export class SessionWorkflowBindingConflictError extends Error {
  readonly code = 'binding_conflict' as const

  constructor(sessionId: string, expected: string | null, actual: string | null) {
    super(
      `Session workflow binding changed concurrently (session=${sessionId}, expected=${expected ?? 'none'}, actual=${actual ?? 'none'})`,
    )
    this.name = 'SessionWorkflowBindingConflictError'
  }
}

/**
 * Persistence boundary for the optional session workflow binding.
 * A missing row is deliberately preserved as the legacy compatibility path.
 */
export class SessionWorkflowBindingRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'session_workflow_bindings')
  }

  get(sessionId: string): SessionWorkflowBinding | null {
    const row = this.getRow(sessionId)
    return row == null ? null : this.toItem(row)
  }

  getRow(sessionId: string): SessionWorkflowBindingRow | null {
    const row = this.raw
      .prepare('SELECT * FROM session_workflow_bindings WHERE session_id = ?')
      .get(sessionId) as SessionWorkflowBindingRow | undefined
    return row ?? null
  }

  /**
   * Insert or update a binding atomically. Repeating the same state is an
   * idempotent no-op and deliberately keeps the existing binding generation.
   */
  set(params: SetSessionWorkflowBindingParams): SetSessionWorkflowBindingResult {
    const mode = params.mode
    const workflowId = mode === 'override' ? (params.workflowId?.trim() ?? null) : null
    if (mode === 'override' && (workflowId == null || workflowId.length === 0)) {
      throw new TypeError('override binding requires a non-empty workflowId')
    }
    if (mode !== 'override' && params.workflowId != null) {
      throw new TypeError(`${mode} binding cannot specify workflowId`)
    }

    const tx = this.raw.transaction(() => {
      const current = this.getRow(params.sessionId)
      const expected = params.expectedBindingInstanceId
      if (expected !== undefined && (current?.binding_instance_id ?? null) !== expected) {
        throw new SessionWorkflowBindingConflictError(
          params.sessionId,
          expected,
          current?.binding_instance_id ?? null,
        )
      }

      if (current != null && current.mode === mode && current.workflow_id === workflowId) {
        return { binding: this.toItem(current), changed: false }
      }

      const now = new Date().toISOString()
      const bindingInstanceId = randomUUID()
      if (current == null) {
        this.raw
          .prepare(
            `INSERT INTO session_workflow_bindings
             (session_id, binding_instance_id, mode, workflow_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(params.sessionId, bindingInstanceId, mode, workflowId, now, now)
      } else {
        this.raw
          .prepare(
            `UPDATE session_workflow_bindings
             SET binding_instance_id = ?, mode = ?, workflow_id = ?, updated_at = ?
             WHERE session_id = ?`,
          )
          .run(bindingInstanceId, mode, workflowId, now, params.sessionId)
      }
      const binding = this.get(params.sessionId)
      if (binding == null) {
        throw new Error('session workflow binding write did not persist')
      }
      return { binding, changed: true }
    })
    return tx() as SetSessionWorkflowBindingResult
  }

  /** Alias with repository naming used by persistence callers. */
  upsert(params: SetSessionWorkflowBindingParams): SetSessionWorkflowBindingResult {
    return this.set(params)
  }

  /**
   * Rotate the binding generation while keeping mode/workflow_id untouched.
   *
   * 用于「放弃并新建运行」：旧代次的 Run 因 binding_instance_id 不再匹配而被
   * 隔离出自动恢复范围，配置本身（挂载哪个工作流）保持不变。与 set() 一样接受
   * 乐观锁期望值；无 Binding 行时抛冲突，防止给旧路径会话凭空造行。
   */
  rotateGeneration(sessionId: string, expectedBindingInstanceId: string): SessionWorkflowBinding {
    const tx = this.raw.transaction(() => {
      const current = this.getRow(sessionId)
      if (current == null || current.binding_instance_id !== expectedBindingInstanceId) {
        throw new SessionWorkflowBindingConflictError(
          sessionId,
          expectedBindingInstanceId,
          current?.binding_instance_id ?? null,
        )
      }
      const bindingInstanceId = randomUUID()
      this.raw
        .prepare(
          `UPDATE session_workflow_bindings
           SET binding_instance_id = ?, updated_at = ?
           WHERE session_id = ?`,
        )
        .run(bindingInstanceId, new Date().toISOString(), sessionId)
      const binding = this.get(sessionId)
      if (binding == null) throw new Error('session workflow binding rotation did not persist')
      return binding
    })
    return tx() as SessionWorkflowBinding
  }

  /** Create a first binding and fail if this session was already touched. */
  create(
    params: Omit<SetSessionWorkflowBindingParams, 'expectedBindingInstanceId'>,
  ): SessionWorkflowBinding {
    const result = this.set({ ...params, expectedBindingInstanceId: null })
    return result.binding
  }

  delete(sessionId: string): boolean {
    return (
      this.raw.prepare('DELETE FROM session_workflow_bindings WHERE session_id = ?').run(sessionId)
        .changes > 0
    )
  }

  /** Copy only stable binding configuration for a fork; runs are not copied. */
  copyForFork(sourceSessionId: string, childSessionId: string): SessionWorkflowBinding | null {
    const source = this.getRow(sourceSessionId)
    if (source == null) return null
    const now = new Date().toISOString()
    const bindingInstanceId = randomUUID()
    this.raw
      .prepare(
        `INSERT INTO session_workflow_bindings
         (session_id, binding_instance_id, mode, workflow_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(childSessionId, bindingInstanceId, source.mode, source.workflow_id, now, now)
    return this.get(childSessionId)
  }

  listByWorkflow(workflowId: string): SessionWorkflowBinding[] {
    const rows = this.raw
      .prepare(
        'SELECT * FROM session_workflow_bindings WHERE workflow_id = ? ORDER BY updated_at DESC',
      )
      .all(workflowId) as SessionWorkflowBindingRow[]
    return rows.map((row) => this.toItem(row))
  }

  private toItem(row: SessionWorkflowBindingRow): SessionWorkflowBinding {
    return {
      sessionId: row.session_id,
      bindingInstanceId: row.binding_instance_id,
      mode: row.mode,
      workflowId: row.workflow_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}
