import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import type {
  RemoteAgentErrorCode,
  RemoteAgentTask,
  RemoteAgentTaskStatus,
  RemoteAgentTransportState,
} from '@spark/protocol'

export type RemoteAgentTaskRow = {
  account_user_id: string
  task_id: string
  request_fingerprint: string
  source_session_id: string
  target_device_id: string
  target_project_id: string
  target_agent_id: string
  remote_session_id: string | null
  status: RemoteAgentTaskStatus
  transport_state: RemoteAgentTransportState
  pending_approval_id: string | null
  result_summary: string | null
  error_code: RemoteAgentErrorCode | null
  created_at: string
  updated_at: string
  completed_at: string | null
  last_event_seq: number
}

export interface CreateRemoteAgentTaskParams {
  accountUserId: string
  taskId: string
  requestFingerprint: string
  sourceSessionId: string
  targetDeviceId: string
  targetProjectId: string
  targetAgentId: string
  createdAt?: string
}

export interface UpdateRemoteAgentTaskParams {
  remoteSessionId?: string | null
  status?: RemoteAgentTaskStatus
  transportState?: RemoteAgentTransportState
  pendingApprovalId?: string | null
  resultSummary?: string | null
  errorCode?: RemoteAgentErrorCode | null
  completedAt?: string | null
  lastEventSeq?: number
  updatedAt?: string
}

export class RemoteAgentTaskConflictError extends Error {
  constructor(taskId: string) {
    super(`远程任务 ID 已用于不同的来源或目标：${taskId}`)
    this.name = 'RemoteAgentTaskConflictError'
  }
}

export class RemoteAgentTaskTransitionError extends Error {
  constructor(from: RemoteAgentTaskStatus, to: RemoteAgentTaskStatus) {
    super(`远程任务状态不能从 ${from} 变更为 ${to}`)
    this.name = 'RemoteAgentTaskTransitionError'
  }
}

const TERMINAL_STATUSES = new Set<RemoteAgentTaskStatus>([
  'completed',
  'failed',
  'rejected',
  'cancelled',
])

export class RemoteAgentTaskRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'remote_agent_tasks')
  }

  /**
   * Creates a local task once. Reusing a taskId for a different source or target
   * is rejected, so a retry cannot silently attach to an unrelated task.
   */
  getOrCreate(params: CreateRemoteAgentTaskParams): { task: RemoteAgentTask; created: boolean } {
    if (!/^[0-9a-f]{64}$/.test(params.requestFingerprint)) {
      throw new Error('远程任务 requestFingerprint 必须是 64 位小写 SHA-256')
    }
    const createdAt = params.createdAt ?? new Date().toISOString()
    const result = this.raw
      .prepare(
        `INSERT INTO remote_agent_tasks (
           account_user_id, task_id, request_fingerprint, source_session_id,
           target_device_id, target_project_id,
           target_agent_id, status, transport_state, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'dispatching', 'unknown', ?, ?)
         ON CONFLICT(account_user_id, task_id) DO NOTHING`,
      )
      .run(
        params.accountUserId,
        params.taskId,
        params.requestFingerprint,
        params.sourceSessionId,
        params.targetDeviceId,
        params.targetProjectId,
        params.targetAgentId,
        createdAt,
        createdAt,
      )

    const row = this.getRow(params.accountUserId, params.taskId)
    if (row == null) throw new Error(`远程任务写入后未找到：${params.taskId}`)
    if (
      row.request_fingerprint !== params.requestFingerprint ||
      row.source_session_id !== params.sourceSessionId ||
      row.target_device_id !== params.targetDeviceId ||
      row.target_project_id !== params.targetProjectId ||
      row.target_agent_id !== params.targetAgentId
    ) {
      throw new RemoteAgentTaskConflictError(params.taskId)
    }

    return { task: toTask(row, params.accountUserId), created: result.changes > 0 }
  }

  get(accountUserId: string, taskId: string): RemoteAgentTask | null {
    const row = this.getRow(accountUserId, taskId)
    return row == null ? null : toTask(row, accountUserId)
  }

  private getRow(accountUserId: string, taskId: string): RemoteAgentTaskRow | null {
    const row = this.raw
      .prepare('SELECT * FROM remote_agent_tasks WHERE account_user_id = ? AND task_id = ?')
      .get(accountUserId, taskId) as RemoteAgentTaskRow | undefined
    return row ?? null
  }

  listBySourceSession(
    accountUserId: string,
    sourceSessionId: string,
    limit = 100,
  ): RemoteAgentTask[] {
    const boundedLimit = Math.max(
      1,
      Math.min(500, Math.trunc(Number.isFinite(limit) ? limit : 100)),
    )
    const rows = this.raw
      .prepare(
        `SELECT * FROM remote_agent_tasks
         WHERE account_user_id = ? AND source_session_id = ?
         ORDER BY created_at DESC, task_id ASC
         LIMIT ?`,
      )
      .all(accountUserId, sourceSessionId, boundedLimit) as RemoteAgentTaskRow[]
    return rows.map((row) => toTask(row, accountUserId))
  }

  listRecoverable(accountUserId: string, limit = 500): RemoteAgentTask[] {
    const boundedLimit = Math.max(
      1,
      Math.min(1_000, Math.trunc(Number.isFinite(limit) ? limit : 500)),
    )
    const rows = this.raw
      .prepare(
        `SELECT * FROM remote_agent_tasks
         WHERE account_user_id = ?
           AND status NOT IN ('completed', 'failed', 'rejected', 'cancelled')
         ORDER BY updated_at ASC, task_id ASC
         LIMIT ?`,
      )
      .all(accountUserId, boundedLimit) as RemoteAgentTaskRow[]
    return rows.map((row) => toTask(row, accountUserId))
  }

  getLastEventSeq(accountUserId: string, taskId: string): number {
    const row = this.raw
      .prepare(
        'SELECT last_event_seq FROM remote_agent_tasks WHERE account_user_id = ? AND task_id = ?',
      )
      .get(accountUserId, taskId) as { last_event_seq?: unknown } | undefined
    return typeof row?.last_event_seq === 'number' ? row.last_event_seq : -1
  }

  update(
    accountUserId: string,
    taskId: string,
    patch: UpdateRemoteAgentTaskParams,
  ): RemoteAgentTask | null {
    const current = this.get(accountUserId, taskId)
    if (current == null) return null

    const updatedAt = patch.updatedAt ?? new Date().toISOString()
    const effectivePatch: UpdateRemoteAgentTaskParams = { ...patch }
    if (patch.lastEventSeq != null) {
      if (!Number.isSafeInteger(patch.lastEventSeq) || patch.lastEventSeq < -1) {
        throw new Error('远程任务事件游标必须是大于等于 -1 的安全整数')
      }
      if (patch.lastEventSeq < this.getLastEventSeq(accountUserId, taskId)) {
        delete effectivePatch.lastEventSeq
      }
    }
    if (patch.status != null && patch.status !== current.status) {
      // 任务行是 B 端生命周期的本地投影：A 断线可能漏收中间事件，恢复补查时
      // 允许跨过未观测到的中间态；唯一硬约束是终态不可复活，挡住迟到的重复回放。
      if (TERMINAL_STATUSES.has(current.status)) {
        throw new RemoteAgentTaskTransitionError(current.status, patch.status)
      }
      if (TERMINAL_STATUSES.has(patch.status) && !Object.hasOwn(patch, 'completedAt')) {
        effectivePatch.completedAt = updatedAt
      }
      const approvalNoLongerPending =
        TERMINAL_STATUSES.has(patch.status) ||
        (current.status === 'awaiting_approval' && patch.status === 'running')
      if (approvalNoLongerPending && !Object.hasOwn(patch, 'pendingApprovalId')) {
        effectivePatch.pendingApprovalId = null
      }
    }

    const assignments: string[] = []
    const values: Array<string | number | null> = []
    const fields: Array<[keyof UpdateRemoteAgentTaskParams, string]> = [
      ['remoteSessionId', 'remote_session_id'],
      ['status', 'status'],
      ['transportState', 'transport_state'],
      ['pendingApprovalId', 'pending_approval_id'],
      ['resultSummary', 'result_summary'],
      ['errorCode', 'error_code'],
      ['completedAt', 'completed_at'],
      ['lastEventSeq', 'last_event_seq'],
    ]

    for (const [field, column] of fields) {
      if (!Object.hasOwn(effectivePatch, field)) continue
      assignments.push(`${column} = ?`)
      values.push((effectivePatch[field] ?? null) as string | number | null)
    }

    if (assignments.length === 0 && patch.updatedAt == null) return current
    assignments.push('updated_at = ?')
    values.push(updatedAt, accountUserId, taskId)
    this.raw
      .prepare(
        `UPDATE remote_agent_tasks SET ${assignments.join(', ')}
         WHERE account_user_id = ? AND task_id = ?`,
      )
      .run(...values)
    return this.get(accountUserId, taskId)
  }
}

function toTask(row: RemoteAgentTaskRow, accountUserId: string): RemoteAgentTask {
  if (row.account_user_id !== accountUserId) {
    throw new Error('远程任务账号隔离校验失败')
  }
  return {
    taskId: row.task_id,
    sourceSessionId: row.source_session_id,
    targetDeviceId: row.target_device_id,
    targetProjectId: row.target_project_id,
    targetAgentId: row.target_agent_id,
    remoteSessionId: row.remote_session_id,
    status: row.status,
    transportState: row.transport_state,
    pendingApprovalId: row.pending_approval_id,
    resultSummary: row.result_summary,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}
