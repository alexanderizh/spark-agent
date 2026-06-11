/**
 * @module event.repository
 *
 * AgentEvent 领域 Repository
 *
 * 职责：
 *   - Agent 事件的写入（append-only）
 *   - 按 session / run / turn 查询事件
 *   - 事件分页查询
 *   - 事件序号管理
 *
 * 约束：
 *   - 事件表是 append-only，不提供 update 和 delete 操作
 *   - event_json 存储完整的 AgentEvent 序列化 JSON
 *   - event_type 字段用于索引加速过滤
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** agent_events 表行类型 */
export interface AgentEventRow {
  id: string
  session_id: string
  run_id: string | null
  turn_id: string | null
  event_type: string
  event_json: string
  created_at: string
}

/** 查询事件的参数 */
export interface QueryEventsParams {
  sessionId: string
  runId?: string
  turnId?: string
  eventType?: string
  /** 分页：取最近 N 个事件，以时间线正序返回 */
  limit?: number
  /** 分页：游标（取 created_at < cursor 的事件） */
  beforeCreatedAt?: string
  /** 分页：游标（取 seq < beforeSeq 的事件） */
  beforeSeq?: number
}

/** 写入事件的参数 */
export interface InsertEventParams {
  id: string
  sessionId: string
  runId?: string
  turnId?: string
  eventType: string
  eventJson: string
}

/**
 * Event Repository
 *
 * 管理 agent_events 表的数据访问
 */
export class EventRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'agent_events')
  }

  /** 写入事件（append-only） */
  insert(params: InsertEventParams): void {
    const stmt = this.raw.prepare(`
      INSERT INTO agent_events (id, session_id, run_id, turn_id, event_type, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      params.id,
      params.sessionId,
      params.runId ?? null,
      params.turnId ?? null,
      params.eventType,
      params.eventJson,
    )
  }

  /** 批量写入事件（在单个事务中） */
  insertBatch(events: InsertEventParams[]): void {
    const stmt = this.raw.prepare(`
      INSERT INTO agent_events (id, session_id, run_id, turn_id, event_type, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const insertAll = this.raw.transaction(() => {
      for (const event of events) {
        stmt.run(
          event.id,
          event.sessionId,
          event.runId ?? null,
          event.turnId ?? null,
          event.eventType,
          event.eventJson,
        )
      }
    })

    insertAll()
  }

  /** 按 session 查询事件（支持分页）。默认取最新页，并以时间线正序返回。 */
  queryBySession(params: QueryEventsParams): { events: AgentEventRow[]; hasMore: boolean } {
    const { sessionId, runId, turnId, eventType, limit = 50, beforeCreatedAt, beforeSeq } = params

    const conditions: string[] = ['session_id = ?']
    const args: unknown[] = [sessionId]

    if (runId != null) {
      conditions.push('run_id = ?')
      args.push(runId)
    }
    if (turnId != null) {
      conditions.push('turn_id = ?')
      args.push(turnId)
    }
    if (eventType != null) {
      conditions.push('event_type = ?')
      args.push(eventType)
    }
    if (beforeCreatedAt != null) {
      conditions.push('created_at < ?')
      args.push(beforeCreatedAt)
    }
    if (beforeSeq != null) {
      conditions.push('CAST(json_extract(event_json, \'$.seq\') AS INTEGER) < ?')
      args.push(beforeSeq)
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`

    const seqOrder = 'CAST(json_extract(event_json, \'$.seq\') AS INTEGER)'

    // 先按时间线倒序取最新页，再在内存中反转为正序，便于 UI 直接回放事件。
    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events ${whereClause} ORDER BY ${seqOrder} DESC, created_at DESC, rowid DESC LIMIT ?`,
    )
    const rows = stmt.all(...args, limit + 1) as AgentEventRow[]

    const hasMore = rows.length > limit
    const events = (hasMore ? rows.slice(0, limit) : rows).reverse()

    return { events, hasMore }
  }

  /**
   * 查询用于构建「对话历史」的事件，按 seq 正序返回。
   *
   * 关键点：assistant_message / team_member_message 在流式时会产生海量 mode='delta'
   * 行（每个 text_delta 一行）。若按普通 queryBySession 取最近 N 行，这些 delta 会
   * 挤占配额，导致真正承载完整文本的 mode='complete' 行被截断、历史出现黑洞。
   * 这里在 SQL 层直接排除 delta（user_message / turn_prompt_snapshot 没有 mode，全取），
   * 把配额全部留给 complete 行。
   */
  queryDialogueEvents(sessionId: string, limit: number = 400): AgentEventRow[] {
    const seqOrder = "CAST(json_extract(event_json, '$.seq') AS INTEGER)"
    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events
       WHERE session_id = ?
         AND (
           event_type IN ('user_message', 'turn_prompt_snapshot')
           OR (
             event_type IN ('assistant_message', 'team_member_message')
             AND json_extract(event_json, '$.mode') = 'complete'
           )
         )
       ORDER BY ${seqOrder} DESC, created_at DESC, rowid DESC
       LIMIT ?`,
    )
    const rows = stmt.all(sessionId, limit) as AgentEventRow[]
    return rows.reverse()
  }

  /** 统计指定 session 的事件数量 */
  countBySession(sessionId: string): number {
    const stmt = this.raw.prepare(
      'SELECT COUNT(*) as count FROM agent_events WHERE session_id = ?',
    )
    const row = stmt.get(sessionId) as { count: number }
    return row.count
  }

  /** 删除指定 session 的所有事件 */
  deleteBySession(sessionId: string): number {
    const stmt = this.raw.prepare('DELETE FROM agent_events WHERE session_id = ?')
    const result = stmt.run(sessionId)
    return result.changes
  }

  /** 按 ID 列表批量删除事件 */
  deleteEventsByIds(ids: string[]): number {
    if (ids.length === 0) return 0
    const placeholders = ids.map(() => '?').join(',')
    const stmt = this.raw.prepare(`DELETE FROM agent_events WHERE id IN (${placeholders})`)
    const result = stmt.run(...ids)
    return result.changes
  }

  /** 按事件内容模糊搜索，返回匹配的 session ID 列表和内容片段 */
  searchByContent(query: string, limit: number = 20): Array<{ sessionId: string; snippet: string }> {
    const pattern = `%${query}%`
    const stmt = this.raw.prepare(
      `SELECT DISTINCT session_id, event_json
       FROM agent_events
       WHERE event_json LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    const rows = stmt.all(pattern, limit * 3) as AgentEventRow[]

    // Deduplicate by session_id, keep the first match per session
    const seen = new Set<string>()
    const results: Array<{ sessionId: string; snippet: string }> = []
    for (const row of rows) {
      if (seen.has(row.session_id)) continue
      seen.add(row.session_id)
      // Extract a text snippet from event_json around the match
      const json = row.event_json
      const idx = json.toLowerCase().indexOf(query.toLowerCase())
      const start = Math.max(0, idx - 40)
      const end = Math.min(json.length, idx + query.length + 60)
      let snippet = json.slice(start, end)
      if (start > 0) snippet = '...' + snippet
      if (end < json.length) snippet = snippet + '...'
      results.push({ sessionId: row.session_id, snippet })
      if (results.length >= limit) break
    }
    return results
  }
}
