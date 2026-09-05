import type { SparkDatabase } from '../database.js'
import { BaseRepository } from './base.repository.js'

export type ToolInvocationSourceKind =
  | 'connector'
  | 'custom-tool'
  | 'tool-package'
  | 'workflow'
  | 'test'
export type ToolInvocationSource = 'model' | 'workflow' | 'test' | 'platform' | 'nested'
export type ToolInvocationStatus = 'running' | 'ok' | 'error' | 'timeout' | 'denied' | 'cancelled'

export interface ToolInvocationRow {
  id: string
  correlation_id: string
  source_kind: ToolInvocationSourceKind
  source_id: string
  package_id: string | null
  tool_id: string | null
  tool_name: string
  version: string | null
  adapter: string | null
  session_id: string | null
  turn_id: string | null
  project_id: string | null
  agent_id: string | null
  workflow_id: string | null
  invocation_source: ToolInvocationSource
  status: ToolInvocationStatus
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  error_code: string | null
  input_sha256: string
  output_bytes: number | null
  result_archived: number
  result_truncated: number
  retry_count: number
  created_at: string
}

export interface StartToolInvocationParams {
  id: string
  correlationId: string
  sourceKind: ToolInvocationSourceKind
  sourceId: string
  packageId?: string
  toolId?: string
  toolName: string
  version?: string
  adapter?: string
  sessionId?: string
  turnId?: string
  projectId?: string
  agentId?: string
  workflowId?: string
  invocationSource: ToolInvocationSource
  inputSha256: string
  startedAt?: string
}

export interface FinishToolInvocationParams {
  status: Exclude<ToolInvocationStatus, 'running'>
  errorCode?: string
  outputBytes?: number
  resultArchived?: boolean
  resultTruncated?: boolean
  retryCount?: number
  finishedAt?: string
}

export interface ListToolInvocationsParams {
  sourceKind?: ToolInvocationSourceKind
  sourceId?: string
  packageId?: string
  toolName?: string
  sessionId?: string
  status?: ToolInvocationStatus
  correlationId?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export class ToolInvocationRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'tool_invocations')
  }

  start(params: StartToolInvocationParams): ToolInvocationRow {
    const startedAt = params.startedAt ?? new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO tool_invocations (
          id, correlation_id, source_kind, source_id, package_id, tool_id, tool_name,
          version, adapter, session_id, turn_id, project_id, agent_id, workflow_id,
          invocation_source, status, started_at, input_sha256, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
      )
      .run(
        params.id,
        params.correlationId,
        params.sourceKind,
        params.sourceId,
        params.packageId ?? null,
        params.toolId ?? null,
        params.toolName,
        params.version ?? null,
        params.adapter ?? null,
        params.sessionId ?? null,
        params.turnId ?? null,
        params.projectId ?? null,
        params.agentId ?? null,
        params.workflowId ?? null,
        params.invocationSource,
        startedAt,
        params.inputSha256,
        startedAt,
      )
    const inserted = this.get(params.id)
    if (inserted == null) {
      throw new Error(`tool_invocations insert failed to read back row ${params.id}`)
    }
    return inserted
  }

  finish(id: string, params: FinishToolInvocationParams): ToolInvocationRow | undefined {
    const current = this.get(id)
    if (current == null) return undefined
    const finishedAt = params.finishedAt ?? new Date().toISOString()
    const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(current.started_at))
    this.raw
      .prepare(
        `UPDATE tool_invocations SET
          status = ?, finished_at = ?, duration_ms = ?, error_code = ?, output_bytes = ?,
          result_archived = ?, result_truncated = ?, retry_count = ?
         WHERE id = ?`,
      )
      .run(
        params.status,
        finishedAt,
        durationMs,
        params.errorCode ?? null,
        params.outputBytes ?? null,
        params.resultArchived === true ? 1 : 0,
        params.resultTruncated === true ? 1 : 0,
        Math.max(0, params.retryCount ?? 0),
        id,
      )
    return this.get(id)
  }

  get(id: string): ToolInvocationRow | undefined {
    return this.raw.prepare('SELECT * FROM tool_invocations WHERE id = ?').get(id) as
      | ToolInvocationRow
      | undefined
  }

  list(params: ListToolInvocationsParams = {}): { items: ToolInvocationRow[]; total: number } {
    const filters: string[] = []
    const values: Array<string | number> = []
    const add = (clause: string, value: string | undefined): void => {
      if (value == null) return
      filters.push(clause)
      values.push(value)
    }
    add('source_kind = ?', params.sourceKind)
    add('source_id = ?', params.sourceId)
    add('package_id = ?', params.packageId)
    add('tool_name = ?', params.toolName)
    add('session_id = ?', params.sessionId)
    add('status = ?', params.status)
    add('correlation_id = ?', params.correlationId)
    add('created_at >= ?', params.from)
    add('created_at <= ?', params.to)
    const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : ''
    const total = (
      this.raw.prepare(`SELECT COUNT(*) AS count FROM tool_invocations${where}`).get(...values) as {
        count: number
      }
    ).count
    const limit = Math.min(200, Math.max(1, params.limit ?? 50))
    const offset = Math.max(0, params.offset ?? 0)
    const items = this.raw
      .prepare(`SELECT * FROM tool_invocations${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...values, limit, offset) as ToolInvocationRow[]
    return { items, total }
  }

  pruneOlderThan(cutoff: string): number {
    return this.raw.prepare('DELETE FROM tool_invocations WHERE created_at < ?').run(cutoff).changes
  }
}
