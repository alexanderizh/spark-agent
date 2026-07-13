/**
 * @module session.repository
 *
 * Session 领域 Repository
 *
 * 职责：
 *   - 会话的 CRUD 操作
 *   - 会话状态管理（idle / running / error）
 *   - 按 workspace / project 查询会话
 *
 * 约束：
 *   - 所有 SQL 通过 prepared statement 执行
 *   - workspace_ids_json 字段的序列化/反序列化由此 Repository 负责
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

const DEFAULT_AGENT_ID = 'platform-manager-agent'

/** Session 表行类型 */
export interface SessionRow {
  id: string
  kind: string
  title: string
  status: string
  project_id: string
  workspace_ids_json: string
  rule_bundle_id: string | null
  permission_profile_id: string | null
  provider_profile_id: string | null
  model_id: string | null
  agent_adapter: string
  agent_id: string
  permission_mode: string
  chat_mode: string
  reasoning_effort: string
  pinned_at: string | null
  archived_at: string | null
  turn_count: number
  logical_message_count: number
  metadata_json: string
  created_at: string
  updated_at: string
}

/** 创建 Session 的参数 */
export interface CreateSessionParams {
  id: string
  kind: string
  title: string
  status: string
  projectId: string
  workspaceIds?: string[]
  ruleBundleId?: string
  permissionProfileId?: string
  providerProfileId?: string
  modelId?: string
  agentAdapter?: string
  agentId?: string
  permissionMode?: string
  chatMode?: string
  reasoningEffort?: string
}

/** Session 列表查询参数 */
export interface ListSessionsParams {
  projectId?: string
  workspaceId?: string
  status?: string
  includeArchived?: boolean
  limit?: number
  offset?: number
}

/**
 * Session Repository
 *
 * 管理 sessions 表的数据访问
 */
export class SessionRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'sessions')
  }

  /** 创建新会话 */
  create(params: CreateSessionParams): SessionRow {
    const now = new Date().toISOString()
    const stmt = this.raw.prepare(`
      INSERT INTO sessions (id, kind, title, status, project_id, workspace_ids_json, rule_bundle_id, permission_profile_id, provider_profile_id, model_id, agent_adapter, agent_id, permission_mode, chat_mode, reasoning_effort, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      params.id,
      params.kind,
      params.title,
      params.status,
      params.projectId,
      this.toJson(params.workspaceIds ?? []),
      params.ruleBundleId ?? null,
      params.permissionProfileId ?? null,
      params.providerProfileId ?? null,
      params.modelId ?? null,
      params.agentAdapter ?? 'codex',
      params.agentId ?? DEFAULT_AGENT_ID,
      params.permissionMode ?? 'codex-default',
      params.chatMode ?? 'agent',
      params.reasoningEffort ?? 'max',
      now,
      now,
    )

    return this.findByIdOrFail(params.id)
  }

  /** 根据 ID 查找会话 */
  get(id: string): SessionRow | null {
    return this.findById<SessionRow>(id)
  }

  /** 根据 ID 查找，找不到则抛异常 */
  findByIdOrFail(id: string): SessionRow {
    const row = this.get(id)
    if (row == null) {
      throw new Error(`Session not found: ${id}`)
    }
    return row
  }

  /** 更新会话状态 */
  updateStatus(id: string, status: string): void {
    const now = new Date().toISOString()
    const stmt = this.raw.prepare(`
      UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?
    `)
    stmt.run(status, now, id)
  }

  /** 更新会话标题 */
  updateTitle(id: string, title: string): void {
    const now = new Date().toISOString()
    const stmt = this.raw.prepare(`
      UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?
    `)
    stmt.run(title, now, id)
  }

  /** 读取 session 的 metadata（JSON 对象；缺省返回 {}） */
  getMetadata(id: string): Record<string, unknown> {
    const row = this.get(id)
    return this.fromJson<Record<string, unknown>>(row?.metadata_json, {})
  }

  /**
   * 浅合并 patch 到 session 的 metadata_json。
   * 用于团队模式等会话级配置（如 metadata.team），不新增列。
   */
  patchMetadata(id: string, patch: Record<string, unknown>): Record<string, unknown> {
    const current = this.getMetadata(id)
    const next = { ...current, ...patch }
    const now = new Date().toISOString()
    this.raw
      .prepare(`UPDATE sessions SET metadata_json = ?, updated_at = ? WHERE id = ?`)
      .run(this.toJson(next), now, id)
    return next
  }

  /** 更新会话生命周期状态 */
  updateLifecycle(id: string, params: { pinnedAt?: string | null; archivedAt?: string | null }): void {
    const fields: string[] = []
    const values: unknown[] = []

    if (params.pinnedAt !== undefined) {
      fields.push('pinned_at = ?')
      values.push(params.pinnedAt)
    }

    if (params.archivedAt !== undefined) {
      fields.push('archived_at = ?')
      values.push(params.archivedAt)
    }

    if (fields.length === 0) return

    fields.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)

    const stmt = this.raw.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)
  }

  /** 更新会话运行配置 */
  updateRuntime(
    id: string,
    params: {
      providerProfileId?: string
      modelId?: string | null
      agentAdapter?: string
      agentId?: string
      permissionMode?: string
      chatMode?: string
      reasoningEffort?: string
    },
  ): void {
    const fields: string[] = []
    const values: unknown[] = []

    if (params.providerProfileId !== undefined) {
      fields.push('provider_profile_id = ?')
      values.push(params.providerProfileId)
    }

    if (params.modelId !== undefined) {
      fields.push('model_id = ?')
      values.push(params.modelId)
    }

    if (params.agentAdapter !== undefined) {
      fields.push('agent_adapter = ?')
      values.push(params.agentAdapter)
    }

    if (params.agentId !== undefined) {
      fields.push('agent_id = ?')
      values.push(params.agentId)
    }

    if (params.permissionMode !== undefined) {
      fields.push('permission_mode = ?')
      values.push(params.permissionMode)
    }

    if (params.chatMode !== undefined) {
      fields.push('chat_mode = ?')
      values.push(params.chatMode)
    }

    if (params.reasoningEffort !== undefined) {
      fields.push('reasoning_effort = ?')
      values.push(params.reasoningEffort)
    }

    if (fields.length === 0) return

    fields.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)

    const stmt = this.raw.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values)
  }

  /** 查询会话列表 */
  list(params: ListSessionsParams = {}): { sessions: SessionRow[]; total: number } {
    const { projectId, workspaceId, status, includeArchived = false, limit = 50, offset = 0 } = params

    // 动态构建 WHERE 子句（参数化，防止 SQL 注入）
    const conditions: string[] = []
    const args: unknown[] = []

    if (projectId != null) {
      conditions.push('project_id = ?')
      args.push(projectId)
    }
    if (status != null) {
      conditions.push('status = ?')
      args.push(status)
    }
    if (!includeArchived) {
      conditions.push('archived_at IS NULL')
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // 查总数
    const countStmt = this.raw.prepare(`SELECT COUNT(*) as count FROM sessions ${whereClause}`)
    const countRow = countStmt.get(...args) as { count: number }

    // 查列表（按更新时间倒序）
    const listStmt = this.raw.prepare(
      `SELECT * FROM sessions ${whereClause}
       ORDER BY pinned_at IS NULL ASC, pinned_at DESC, updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    const sessions = listStmt.all(...args, limit, offset) as SessionRow[]

    // 如果指定了 workspaceId，在内存中过滤（workspace_ids_json 是 JSON 数组）
    const filtered = workspaceId != null
      ? sessions.filter((s) => {
          const wsIds = this.fromJson<string[]>(s.workspace_ids_json, [])
          return wsIds.includes(workspaceId)
        })
      : sessions

    return { sessions: filtered, total: countRow.count }
  }

  /** 获取 workspace_ids_json 解析后的数组 */
  getWorkspaceIds(sessionId: string): string[] {
    const row = this.get(sessionId)
    if (row == null) return []
    return this.getWorkspaceIdsFromRow(row)
  }

  /** 从已查询到的 session row 中解析 workspace ids，避免列表渲染时按行二次查库。 */
  getWorkspaceIdsFromRow(row: Pick<SessionRow, 'workspace_ids_json'>): string[] {
    return this.fromJson<string[]>(row.workspace_ids_json, [])
  }

  /** 按标题模糊搜索 */
  searchByTitle(query: string, limit: number = 20): SessionRow[] {
    const pattern = `%${query}%`
    const stmt = this.raw.prepare(
      `SELECT * FROM sessions WHERE archived_at IS NULL AND title LIKE ? ORDER BY updated_at DESC LIMIT ?`,
    )
    return stmt.all(pattern, limit) as SessionRow[]
  }

  /** 删除会话记录 */
  delete(id: string): boolean {
    return this.deleteById(id)
  }

  /** 删除指定 workspace 下的会话记录 */
  deleteByWorkspaceId(workspaceId: string): string[] {
    const rows = this.list({ workspaceId, includeArchived: true, limit: 1000 }).sessions
    const stmt = this.raw.prepare('DELETE FROM sessions WHERE id = ?')
    const deletedIds: string[] = []
    const remove = this.raw.transaction(() => {
      for (const row of rows) {
        const result = stmt.run(row.id)
        if (result.changes > 0) deletedIds.push(row.id)
      }
    })
    remove()
    return deletedIds
  }
}
