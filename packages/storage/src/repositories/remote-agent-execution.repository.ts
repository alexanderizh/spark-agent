import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

export type RemoteAgentExecutionPhase = 'reserved' | 'session_created' | 'submitting' | 'submitted'

export type RemoteAgentDispatchStatus = 'queued' | 'running'

export interface RemoteAgentExecutionAttachment {
  type: 'image' | 'file'
  path: string
}

export interface RemoteAgentExecutionRow {
  account_user_id: string
  task_id: string
  request_fingerprint: string
  source_session_id: string
  target_project_id: string
  target_agent_id: string
  remote_session_id: string | null
  turn_id: string | null
  status: RemoteAgentExecutionPhase
  dispatch_status: RemoteAgentDispatchStatus | null
  attachment_paths_json: string | null
  created_at: string
  updated_at: string
}

export interface ReserveRemoteAgentExecutionParams {
  accountUserId: string
  taskId: string
  requestFingerprint: string
  sourceSessionId: string
  targetProjectId: string
  targetAgentId: string
}

export class RemoteAgentExecutionConflictError extends Error {
  constructor(taskId: string) {
    super(`远程任务 ID 已用于不同的请求：${taskId}`)
    this.name = 'RemoteAgentExecutionConflictError'
  }
}

export class RemoteAgentExecutionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'remote_agent_executions')
  }

  reserve(params: ReserveRemoteAgentExecutionParams): {
    execution: RemoteAgentExecutionRow
    created: boolean
  } {
    if (!/^[0-9a-f]{64}$/.test(params.requestFingerprint)) {
      throw new Error('远程任务 requestFingerprint 必须是 64 位小写 SHA-256')
    }
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `INSERT INTO remote_agent_executions (
           account_user_id, task_id, request_fingerprint, source_session_id,
           target_project_id, target_agent_id, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)
         ON CONFLICT(account_user_id, task_id) DO NOTHING`,
      )
      .run(
        params.accountUserId,
        params.taskId,
        params.requestFingerprint,
        params.sourceSessionId,
        params.targetProjectId,
        params.targetAgentId,
        now,
        now,
      )

    const execution = this.get(params.accountUserId, params.taskId)
    if (execution == null) throw new Error(`远程任务映射写入后未找到：${params.taskId}`)
    if (
      execution.request_fingerprint !== params.requestFingerprint ||
      execution.source_session_id !== params.sourceSessionId ||
      execution.target_project_id !== params.targetProjectId ||
      execution.target_agent_id !== params.targetAgentId
    ) {
      throw new RemoteAgentExecutionConflictError(params.taskId)
    }
    return { execution, created: result.changes > 0 }
  }

  get(accountUserId: string, taskId: string): RemoteAgentExecutionRow | null {
    const row = this.raw
      .prepare('SELECT * FROM remote_agent_executions WHERE account_user_id = ? AND task_id = ?')
      .get(accountUserId, taskId) as RemoteAgentExecutionRow | undefined
    return row ?? null
  }

  setAttachmentPaths(
    accountUserId: string,
    taskId: string,
    attachments: RemoteAgentExecutionAttachment[],
  ): RemoteAgentExecutionRow {
    const serialized = JSON.stringify(attachments)
    this.raw
      .prepare(
        `UPDATE remote_agent_executions
         SET attachment_paths_json = ?, updated_at = ?
         WHERE account_user_id = ? AND task_id = ? AND attachment_paths_json IS NULL`,
      )
      .run(serialized, new Date().toISOString(), accountUserId, taskId)
    const execution = this.get(accountUserId, taskId)
    if (execution == null) throw new Error(`远程任务映射不存在：${taskId}`)
    if (execution.attachment_paths_json !== serialized) {
      throw new RemoteAgentExecutionConflictError(taskId)
    }
    return execution
  }

  setRemoteSessionId(
    accountUserId: string,
    taskId: string,
    remoteSessionId: string,
  ): RemoteAgentExecutionRow {
    this.raw
      .prepare(
        `UPDATE remote_agent_executions
         SET remote_session_id = ?, updated_at = ?
         WHERE account_user_id = ? AND task_id = ?
           AND (remote_session_id IS NULL OR remote_session_id = ?)`,
      )
      .run(remoteSessionId, new Date().toISOString(), accountUserId, taskId, remoteSessionId)
    const execution = this.require(accountUserId, taskId)
    if (execution.remote_session_id !== remoteSessionId) {
      throw new RemoteAgentExecutionConflictError(taskId)
    }
    return execution
  }

  markSessionCreated(accountUserId: string, taskId: string): RemoteAgentExecutionRow {
    this.advance(accountUserId, taskId, 'session_created', ['reserved'])
    return this.require(accountUserId, taskId)
  }

  markSubmitting(accountUserId: string, taskId: string): RemoteAgentExecutionRow {
    this.advance(accountUserId, taskId, 'submitting', ['reserved', 'session_created'])
    return this.require(accountUserId, taskId)
  }

  markSubmitted(
    accountUserId: string,
    taskId: string,
    turnId: string,
    dispatchStatus: RemoteAgentDispatchStatus,
  ): RemoteAgentExecutionRow {
    const current = this.require(accountUserId, taskId)
    if (current.turn_id != null && current.turn_id !== turnId) {
      throw new RemoteAgentExecutionConflictError(taskId)
    }
    this.raw
      .prepare(
        `UPDATE remote_agent_executions
         SET status = 'submitted', turn_id = ?, dispatch_status = ?, updated_at = ?
         WHERE account_user_id = ? AND task_id = ?
           AND status IN ('submitting', 'submitted')`,
      )
      .run(turnId, dispatchStatus, new Date().toISOString(), accountUserId, taskId)
    const execution = this.require(accountUserId, taskId)
    if (
      execution.status !== 'submitted' ||
      execution.dispatch_status == null ||
      execution.turn_id !== turnId
    ) {
      throw new Error(`远程任务回合未能记录为已提交：${taskId}`)
    }
    return execution
  }

  private advance(
    accountUserId: string,
    taskId: string,
    next: RemoteAgentExecutionPhase,
    allowedPrevious: RemoteAgentExecutionPhase[],
  ): void {
    const placeholders = allowedPrevious.map(() => '?').join(', ')
    this.raw
      .prepare(
        `UPDATE remote_agent_executions
         SET status = ?, updated_at = ?
         WHERE account_user_id = ? AND task_id = ? AND status IN (${placeholders})`,
      )
      .run(next, new Date().toISOString(), accountUserId, taskId, ...allowedPrevious)
  }

  private require(accountUserId: string, taskId: string): RemoteAgentExecutionRow {
    const execution = this.get(accountUserId, taskId)
    if (execution == null) throw new Error(`远程任务映射不存在：${taskId}`)
    return execution
  }
}
