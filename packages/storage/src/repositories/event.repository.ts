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

import { BaseRepository, type SqliteDatabase } from './base.repository.js'
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
  seq?: number | null
  event_mode?: string | null
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
      conditions.push("CAST(json_extract(event_json, '$.seq') AS INTEGER) < ?")
      args.push(beforeSeq)
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`

    const seqOrder = 'seq'

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
   * 按 session 分页查询「可渲染」事件（用于 UI 历史加载，支持向上翻页）。
   *
   * 与 queryBySession 的关键区别：在 SQL 层**排除流式 delta 行**
   * （assistant_message / agent_thinking / team_member_message / subagent_message 的 mode='delta'）。
   * 一个长回复会产生成百上千条 delta 行，但承载完整文本的是对应的 mode='complete' 行；
   * 渲染历史只需 complete + 其余所有事件类型（tool_call/file_change/terminal/...）。
   * 排除 delta 后，单页事件数与载荷骤降，避免大会话/1M 上下文加载时主线程被
   * 海量 JSON.parse + IPC 结构化克隆卡死。
   *
   * 语义同 queryBySession：默认取最新页，按 seq 正序返回；beforeSeq 用于向上翻页。
   */
  queryRenderablePage(params: { sessionId: string; limit?: number; beforeSeq?: number }): {
    events: AgentEventRow[]
    hasMore: boolean
  } {
    const { sessionId, limit = 80, beforeSeq } = params
    const seqExpr = 'seq'

    const conditions: string[] = ['session_id = ?']
    const args: unknown[] = [sessionId]
    if (beforeSeq != null) {
      conditions.push(`${seqExpr} < ?`)
      args.push(beforeSeq)
    }
    // 排除流式增量行，保留 complete 与所有非流式事件类型。
    // COALESCE 兜底：无 mode 字段（json_extract 返回 NULL）的行视为非 delta，保留。
    conditions.push(
      `NOT (event_type IN ('assistant_message', 'agent_thinking', 'team_member_message', 'subagent_message') ` +
        `AND COALESCE(event_mode, '') = 'delta')`,
    )
    const whereClause = `WHERE ${conditions.join(' AND ')}`

    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events ${whereClause} ORDER BY ${seqExpr} DESC, created_at DESC, rowid DESC LIMIT ?`,
    )
    const rows = stmt.all(...args, limit + 1) as AgentEventRow[]
    const hasMore = rows.length > limit
    const events = (hasMore ? rows.slice(0, limit) : rows).reverse()
    return { events, hasMore }
  }

  /**
   * 按「轮次」分页查询可渲染事件（UI 历史加载首选）。
   *
   * Agentic 会话里单个轮次（turn）可能有数千条事件，按事件数分页会把一个轮次切碎，
   * 出现「只显示一条消息」。这里改为按轮次分页：取最近 turnLimit 个完整轮次的全部
   * 可渲染事件（已排除流式 delta），保证每页都是完整对话、永不切碎。
   *
   * beforeSeq：向上翻页游标——只取「轮次最大 seq < beforeSeq」的更早轮次（即当前
   * 已加载最旧事件之前的轮次），与 queryRenderablePage 共用同一游标语义。
   * 无 turn_id 的会话级事件（project_context_loaded 等，通常仅数条）每页都带上，
   * 由渲染端按 id 去重，确保项目上下文等信息不丢。
   */
  queryRenderableTurns(params: {
    sessionId: string
    turnLimit?: number
    eventLimit?: number
    beforeSeq?: number
  }): { events: AgentEventRow[]; hasMore: boolean } {
    const { sessionId, turnLimit = 6, eventLimit, beforeSeq } = params
    const seqExpr = 'seq'
    const deltaExclude =
      `NOT (event_type IN ('assistant_message', 'agent_thinking', 'team_member_message', 'subagent_message') ` +
      `AND COALESCE(event_mode, '') = 'delta')`

    // 1) 选出最近的 turnLimit(+1 探测 hasMore) 个轮次（按轮次最大 seq 倒序）
    const turnConds: string[] = ['session_id = ?', 'turn_id IS NOT NULL']
    const turnArgs: unknown[] = [sessionId]
    if (beforeSeq != null) {
      turnConds.push(`${seqExpr} < ?`)
      turnArgs.push(beforeSeq)
    }
    const turnStmt = this.raw.prepare(
      `SELECT turn_id FROM agent_events WHERE ${turnConds.join(' AND ')}
       GROUP BY turn_id ORDER BY MAX(${seqExpr}) DESC LIMIT ?`,
    )
    const turnRows = turnStmt.all(...turnArgs, turnLimit + 1) as Array<{ turn_id: string }>
    const hasMore = turnRows.length > turnLimit
    const turnIds = turnRows.slice(0, turnLimit).map((r) => r.turn_id)
    if (turnIds.length === 0) return { events: [], hasMore: false }
    const limitParams = eventLimit != null ? { eventLimit } : {}
    const selectedTurnIds = selectTurnIdsWithinEventLimit({
      raw: this.raw,
      sessionId,
      turnIds,
      deltaExclude,
      ...limitParams,
    })

    // 2) 取这些轮次（+ 会话级 null turn_id）的全部可渲染事件，按 seq 正序
    const placeholders = selectedTurnIds.map(() => '?').join(', ')
    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events
       WHERE session_id = ? AND ${deltaExclude}
         AND (
           turn_id IN (${placeholders})
           OR turn_id IS NULL
         )
       ORDER BY ${seqExpr} ASC, created_at ASC, rowid ASC`,
    )
    const events = stmt.all(sessionId, ...selectedTurnIds) as AgentEventRow[]
    return { events, hasMore: hasMore || selectedTurnIds.length < turnIds.length }
  }

  /** 取某 session 内指定类型的最近一条事件（按 seq 倒序）。无则返回 null。 */
  getLatestByType(sessionId: string, eventType: string): AgentEventRow | null {
    const seqExpr = 'seq'
    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events
       WHERE session_id = ? AND event_type = ?
       ORDER BY ${seqExpr} DESC, created_at DESC, rowid DESC
       LIMIT 1`,
    )
    return (stmt.get(sessionId, eventType) as AgentEventRow | undefined) ?? null
  }

  /** 按 session 查询完整事件历史，按时间线正序返回。 */
  queryAllBySession(sessionId: string): AgentEventRow[] {
    const seqOrder = 'seq'
    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events
       WHERE session_id = ?
       ORDER BY ${seqOrder} ASC, created_at ASC, rowid ASC`,
    )
    return stmt.all(sessionId) as AgentEventRow[]
  }

  /** 查询指定 turn 的正文/思考流事件，包括不会进入可渲染历史页的 delta。 */
  queryStreamEventsByTurn(sessionId: string, turnId: string): AgentEventRow[] {
    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events
       WHERE session_id = ? AND turn_id = ?
         AND event_type IN ('assistant_message', 'agent_thinking', 'team_member_message', 'subagent_message')
       ORDER BY seq ASC, created_at ASC, rowid ASC`,
    )
    return stmt.all(sessionId, turnId) as AgentEventRow[]
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
    const seqOrder = 'seq'
    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events
       WHERE session_id = ?
         AND (
           event_type IN ('user_message', 'turn_prompt_snapshot')
           OR (
             event_type IN ('assistant_message', 'team_member_message')
             AND event_mode = 'complete'
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
    const stmt = this.raw.prepare('SELECT COUNT(*) as count FROM agent_events WHERE session_id = ?')
    const row = stmt.get(sessionId) as { count: number }
    return row.count
  }

  /** 从已持久化的最大 seq 分配下一个序号，不受删除行或 delta 过滤影响。 */
  nextSeqBySession(sessionId: string): number {
    const stmt = this.raw.prepare(
      'SELECT COALESCE(MAX(seq), -1) + 1 AS nextSeq FROM agent_events WHERE session_id = ?',
    )
    const row = stmt.get(sessionId) as { nextSeq: number }
    return row.nextSeq
  }

  /** 批量统计多个 session 的事件数量，避免会话列表刷新时 N+1 查询。 */
  countBySessions(sessionIds: string[]): Map<string, number> {
    if (sessionIds.length === 0) return new Map()
    const placeholders = sessionIds.map(() => '?').join(',')
    const stmt = this.raw.prepare(
      `SELECT session_id as sessionId, COUNT(*) as count
       FROM agent_events
       WHERE session_id IN (${placeholders})
       GROUP BY session_id`,
    )
    const rows = stmt.all(...sessionIds) as Array<{ sessionId: string; count: number }>
    return new Map(rows.map((row) => [row.sessionId, row.count] as const))
  }

  /** 删除指定 session 的所有事件 */
  deleteBySession(sessionId: string): number {
    const stmt = this.raw.prepare('DELETE FROM agent_events WHERE session_id = ?')
    const result = stmt.run(sessionId)
    return result.changes
  }

  /**
   * 分批删除指定 session 的事件。
   *
   * 用于 UI 交互后的后台清理：单批控制在较小 rowid 集合，避免一个巨大 DELETE
   * 长时间占住 Electron main 进程。
   */
  deleteBySessionBatch(sessionId: string, batchSize: number = 1000): number {
    const safeBatchSize = Math.max(1, Math.min(5000, Math.floor(batchSize)))
    const rows = this.raw
      .prepare('SELECT rowid FROM agent_events WHERE session_id = ? LIMIT ?')
      .all(sessionId, safeBatchSize) as Array<{ rowid: number }>
    if (rows.length === 0) return 0
    const placeholders = rows.map(() => '?').join(',')
    const stmt = this.raw.prepare(`DELETE FROM agent_events WHERE rowid IN (${placeholders})`)
    const result = stmt.run(...rows.map((row) => row.rowid))
    return result.changes
  }

  /** 分批删除没有对应 session row 的孤儿事件。 */
  deleteOrphanedSessionEventsBatch(batchSize: number = 1000): number {
    const safeBatchSize = Math.max(1, Math.min(5000, Math.floor(batchSize)))
    const rows = this.raw
      .prepare(
        `SELECT e.rowid
         FROM agent_events e
         LEFT JOIN sessions s ON s.id = e.session_id
         WHERE s.id IS NULL
         LIMIT ?`,
      )
      .all(safeBatchSize) as Array<{ rowid: number }>
    if (rows.length === 0) return 0
    const placeholders = rows.map(() => '?').join(',')
    const stmt = this.raw.prepare(`DELETE FROM agent_events WHERE rowid IN (${placeholders})`)
    const result = stmt.run(...rows.map((row) => row.rowid))
    return result.changes
  }

  /** Delete historical high-volume stream deltas in small, event-loop-friendly batches. */
  deleteTransientDeltasBatch(batchSize: number = 1000): number {
    const safeBatchSize = Math.max(1, Math.min(5000, Math.floor(batchSize)))
    const rows = this.raw
      .prepare(
        `
        SELECT rowid
        FROM agent_events
        WHERE event_type IN (
          'assistant_message',
          'agent_thinking',
          'team_member_message',
          'subagent_message'
        )
          AND event_mode = 'delta'
        LIMIT ?
      `,
      )
      .all(safeBatchSize) as Array<{ rowid: number }>
    if (rows.length === 0) return 0
    const placeholders = rows.map(() => '?').join(',')
    const result = this.raw
      .prepare(`DELETE FROM agent_events WHERE rowid IN (${placeholders})`)
      .run(...rows.map((row) => row.rowid))
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
  searchByContent(
    query: string,
    limit: number = 20,
  ): Array<{ sessionId: string; snippet: string }> {
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

function selectTurnIdsWithinEventLimit(params: {
  raw: SqliteDatabase
  sessionId: string
  turnIds: string[]
  deltaExclude: string
  eventLimit?: number
}): string[] {
  const { raw, sessionId, turnIds, deltaExclude, eventLimit } = params
  if (eventLimit == null || !Number.isFinite(eventLimit) || turnIds.length <= 1) return turnIds
  const placeholders = turnIds.map(() => '?').join(', ')
  const stmt = raw.prepare(
    `SELECT turn_id as turnId, COUNT(*) as count
     FROM agent_events
     WHERE session_id = ? AND ${deltaExclude} AND turn_id IN (${placeholders})
     GROUP BY turn_id`,
  )
  const rows = stmt.all(sessionId, ...turnIds) as Array<{ turnId: string; count: number }>
  const counts = new Map(rows.map((row) => [row.turnId, row.count] as const))
  const selected: string[] = []
  let total = 0
  for (const turnId of turnIds) {
    const count = counts.get(turnId) ?? 0
    if (selected.length > 0 && total + count > eventLimit) break
    selected.push(turnId)
    total += count
  }
  return selected.length > 0 ? selected : [turnIds[0]!]
}
