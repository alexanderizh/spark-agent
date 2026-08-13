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
import { buildFtsMatchQuery, segmentCjk } from '../segment-cjk.js'

/**
 * 参与会话内容检索的事件类型。
 *
 * 只索引真正的对话正文：工具调用参数、文件 diff、终端输出、base64 之类的载荷
 * 既是噪音也会把索引撑爆。用户搜「会话里说过什么」，指的就是这两类。
 */
const SEARCHABLE_EVENT_TYPES = new Set(['user_message', 'assistant_message'])

/** 单条事件参与索引的正文上限，防止超长贴文把 FTS 索引撑爆 */
const MAX_INDEXED_BODY_CHARS = 20_000

/**
 * 从事件 JSON 中取出可检索的纯文本正文。
 *
 * @returns 可索引正文；该事件不参与检索时返回 null。
 */
export function extractSearchableEventBody(eventType: string, eventJson: string): string | null {
  if (!SEARCHABLE_EVENT_TYPES.has(eventType)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(eventJson)
  } catch {
    return null
  }
  if (parsed == null || typeof parsed !== 'object') return null
  const event = parsed as {
    content?: unknown
    mode?: unknown
    userMessageVisibility?: unknown
  }
  if (eventType === 'user_message' && event.userMessageVisibility === 'hidden') return null
  // 流式 delta 是同一段正文的碎片，索引它们会产生大量重复命中；只索引完整消息。
  if (event.mode === 'delta') return null
  if (typeof event.content !== 'string') return null
  const content = event.content.trim()
  if (content.length === 0) return null
  return content.slice(0, MAX_INDEXED_BODY_CHARS)
}

/** snippet 上下文窗口：匹配点前后各保留的字符数 */
const SNIPPET_CONTEXT_CHARS = 40
/** snippet 总长度上限（含前后省略号），避免超长正文撑爆搜索结果列表 */
const SNIPPET_MAX_TOTAL_CHARS = 160

/**
 * 从纯文本正文里围绕第一个匹配位置切一个短片段。
 *
 * 这是给会话搜索结果列表用的「预览」，不是完整正文：
 *   - 大小写不敏感地找第一个匹配位置
 *   - 前后各留 {@link SNIPPET_CONTEXT_CHARS} 字符上下文
 *   - 超出总长 {@link SNIPPET_MAX_TOTAL_CHARS} 时两端加省略号
 *
 * 输入必须是纯文本（已通过 extractSearchableEventBody 从 event_json 取出），
 * 不能是原始 JSON——否则用户看到的就是 `..."content":"...` 这种乱码。
 */
export function makeTextSnippet(body: string, query: string): string {
  if (body.length === 0) return ''
  const needle = query.toLowerCase()
  const haystack = body.toLowerCase()
  const idx = needle.length > 0 ? haystack.indexOf(needle) : -1

  if (idx < 0) {
    // FTS 命中但 JS 字面量找不到（CJK 分词后 token 序列匹配，但原文里大小写/组合不同）：
    // 返回正文头部作为预览，总比空字符串好
    const head = body.slice(0, SNIPPET_MAX_TOTAL_CHARS)
    return body.length > SNIPPET_MAX_TOTAL_CHARS ? head + '...' : head
  }

  const end = idx + query.length
  const start = Math.max(0, idx - SNIPPET_CONTEXT_CHARS)
  const maxEnd = Math.min(body.length, end + SNIPPET_CONTEXT_CHARS)
  let snippet = body.slice(start, maxEnd)
  if (start > 0) snippet = '...' + snippet
  if (maxEnd < body.length) snippet = snippet + '...'
  // 兜底：极少数情况下（前后省略号 + 长匹配词）仍可能超长，硬截断
  if (snippet.length > SNIPPET_MAX_TOTAL_CHARS + 6) {
    snippet = snippet.slice(0, SNIPPET_MAX_TOTAL_CHARS) + '...'
  }
  return snippet
}

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

    // 同一事务内同步更新会话内容搜索索引（FTS5）。
    // 与主表分离：非 user/assistant 消息 / 流式 delta 不进 FTS，
    // 既避免噪音也避免把索引撑爆。详见 061_agent_event_fts.sql。
    const tx = this.raw.transaction(() => {
      stmt.run(
        params.id,
        params.sessionId,
        params.runId ?? null,
        params.turnId ?? null,
        params.eventType,
        params.eventJson,
      )
      this.indexEventForSearch(params)
    })
    tx()
  }

  /** 批量写入事件（在单个事务中） */
  insertBatch(events: InsertEventParams[]): void {
    const insertAll = this.raw.transaction(() => {
      this.insertBatchInTransaction(events)
    })

    insertAll()
  }

  /**
   * Insert events while the caller owns an outer SQLite transaction.
   * Collaboration fork creation uses this to atomically persist the child,
   * lineage record and materialized event snapshot.
   */
  insertBatchInTransaction(events: InsertEventParams[]): void {
    const stmt = this.raw.prepare(`
      INSERT INTO agent_events (id, session_id, run_id, turn_id, event_type, event_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const event of events) {
      stmt.run(
        event.id,
        event.sessionId,
        event.runId ?? null,
        event.turnId ?? null,
        event.eventType,
        event.eventJson,
      )
      this.indexEventForSearch(event)
    }
  }

  /**
   * 把一条事件的可检索正文写入 agent_event_fts。
   *
   * 失败不能让事件写入回滚——搜索是次要能力，主表完整性优先。
   * FTS 表可能因为未迁移（旧库升级到 061 前）或迁移跳过而不存在，
   * 用 sqlite_master 探测一次后缓存结果避免每条事件都查。
   */
  private indexEventForSearch(params: InsertEventParams): void {
    if (!this.ensureSearchIndexAvailable()) return
    const body = extractSearchableEventBody(params.eventType, params.eventJson)
    if (body == null) return
    try {
      // 先在映射表里插入，拿到稳定的 rowid，再用它写 FTS。
      // 映射表 event_id UNIQUE，并发或重放不会重复建项。
      const info = this.raw
        .prepare(`INSERT OR IGNORE INTO agent_event_fts_map (event_id, session_id) VALUES (?, ?)`)
        .run(params.id, params.sessionId)
      const rowid =
        info.lastInsertRowid != null
          ? (info.lastInsertRowid as number | bigint)
          : (
              this.raw
                .prepare('SELECT rowid FROM agent_event_fts_map WHERE event_id = ?')
                .get(params.id) as { rowid: number | bigint } | undefined
            )?.rowid
      if (rowid == null) return
      // segmentCjk 必须与查询侧一致——这是 FTS5 CJK 检索的硬约束。
      this.raw
        .prepare('INSERT OR REPLACE INTO agent_event_fts (rowid, body) VALUES (?, ?)')
        .run(rowid, segmentCjk(body))
    } catch {
      // 静默：FTS 是次要能力，且表缺失已在 ensureSearchIndexAvailable 处理
    }
  }

  /** agent_event_fts 是否可用（061 已应用且表真实存在）。结果缓存。 */
  private searchIndexEnabled: boolean | undefined

  private ensureSearchIndexAvailable(): boolean {
    if (this.searchIndexEnabled === true) return true
    if (this.searchIndexEnabled === undefined) {
      try {
        const row = this.raw
          .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_event_fts'`)
          .get() as { name: string } | undefined
        this.searchIndexEnabled = row?.name === 'agent_event_fts'
      } catch {
        this.searchIndexEnabled = false
      }
    }
    return this.searchIndexEnabled === true
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

  /**
   * 取指定事件类型中 JSON 字段匹配的最近一条记录。
   * JSON path 与值均使用参数绑定；用于按稳定 SDK session id 查找各自最近快照，
   * 避免 Host/Member 交替执行时被全局“最后一条快照”干扰。
   */
  getLatestByTypeAndJsonValue(
    sessionId: string,
    eventType: string,
    jsonPath: string,
    value: string,
  ): AgentEventRow | null {
    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events
       WHERE session_id = ? AND event_type = ?
         AND json_extract(event_json, ?) = ?
       ORDER BY seq DESC, created_at DESC, rowid DESC
       LIMIT 1`,
    )
    return (stmt.get(sessionId, eventType, jsonPath, value) as AgentEventRow | undefined) ?? null
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

  /**
   * 从给定 seq 水位之后按正序读取最早一批对话事件。
   *
   * 连续性胶囊必须严格按水位推进，不能使用“最近 N 条”查询后把中间未处理区间
   * 一并标记为已覆盖。该查询只返回 complete 对话事件并从最早未覆盖行开始。
   */
  queryDialogueEventsAfterSeq(
    sessionId: string,
    afterSeq: number,
    limit: number = 100,
  ): AgentEventRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM agent_events
         WHERE session_id = ?
           AND seq > ?
           AND (
             event_type IN ('user_message', 'turn_prompt_snapshot')
             OR (
               event_type IN ('assistant_message', 'team_member_message')
               AND event_mode = 'complete'
             )
           )
         ORDER BY seq ASC, created_at ASC, rowid ASC
         LIMIT ?`,
      )
      .all(sessionId, afterSeq, limit) as AgentEventRow[]
  }

  /** Count complete dialogue events after a capsule waterline without loading their payloads. */
  countDialogueEventsAfterSeq(sessionId: string, afterSeq: number): number {
    const row = this.raw
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_events
         WHERE session_id = ?
           AND seq > ?
           AND (
             event_type IN ('user_message', 'turn_prompt_snapshot')
             OR (
               event_type IN ('assistant_message', 'team_member_message')
               AND event_mode = 'complete'
             )
           )`,
      )
      .get(sessionId, afterSeq) as { count: number }
    return row.count
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

  /**
   * 清除 turn_prompt_snapshot 事件中的大文本字段（systemPromptSections /
   * userMessage / runtimeLoadStatus），仅保留续会话所需的元数据。
   *
   * 用于「设置 → 存储与备份」的历史运行时快照清理：把长期累积的庞大提示词
   * 快照瘦身为元数据，回收 spark.db 空间。续会话判定（getLatestMatchingTurnPromptSnapshot）
   * 只读 model / providerProfileId / adapterKind / sdkSessionId，完全不依赖这些文本块，
   * 因此清理后老会话仍可正常 resume。
   *
   * 在 SQL 层用 json_remove 直接改写 event_json，分批执行避免单个大事务长时间占住
   * Electron main 进程；每批 UPDATE 后这些字段变为不存在，下一轮 SELECT 自然不再命中，
   * 循环收敛。返回累计清理的行数（配合外部 VACUUM 才能真正回收磁盘空间）。
   */
  pruneTurnPromptSnapshotPayloads(batchSize: number = 1000): number {
    const safeBatchSize = Math.max(1, Math.min(5000, Math.floor(batchSize)))
    let totalRows = 0
    for (;;) {
      const rows = this.raw
        .prepare(
          `SELECT rowid
           FROM agent_events
           WHERE event_type = 'turn_prompt_snapshot'
             AND json_valid(event_json) = 1
             AND (
               json_extract(event_json, '$.systemPromptSections') IS NOT NULL
               OR json_extract(event_json, '$.userMessage') IS NOT NULL
               OR json_extract(event_json, '$.runtimeLoadStatus') IS NOT NULL
             )
           LIMIT ?`,
        )
        .all(safeBatchSize) as Array<{ rowid: number }>
      if (rows.length === 0) break
      const placeholders = rows.map(() => '?').join(',')
      this.raw
        .prepare(
          `UPDATE agent_events
             SET event_json = json_remove(
               event_json,
               '$.systemPromptSections',
               '$.userMessage',
               '$.runtimeLoadStatus'
             )
           WHERE rowid IN (${placeholders})`,
        )
        .run(...rows.map((row) => row.rowid))
      totalRows += rows.length
    }
    return totalRows
  }

  /**
   * 重建数据库文件（VACUUM），把已删除/改写数据留下的空闲页真正还给文件系统。
   *
   * pruneTurnPromptSnapshotPayloads 只是把 event_json 改短，SQLite 不会自动缩小
   * 数据库文件；配合 VACUUM 才能让 spark.db 在磁盘上实际变小。WAL 模式下先
   * checkpoint(TRUNCATE) 把 WAL 内容并入主库再 VACUUM。仅在用户主动清理时调用，
   * 大库可能阻塞 main 进程数秒。
   */
  vacuum(): void {
    try {
      this.raw.pragma('wal_checkpoint(TRUNCATE)')
    } catch {
      // 非 WAL 模式或 checkpoint 失败时忽略，VACUUM 仍可继续
    }
    this.raw.exec('VACUUM')
  }

  /** 按 ID 列表批量删除事件 */
  deleteEventsByIds(ids: string[]): number {
    if (ids.length === 0) return 0
    const placeholders = ids.map(() => '?').join(',')
    const stmt = this.raw.prepare(`DELETE FROM agent_events WHERE id IN (${placeholders})`)
    const result = stmt.run(...ids)
    return result.changes
  }

  /**
   * 按事件内容搜索，返回匹配的 session ID 列表和内容片段。
   *
   * 走 agent_event_fts（FTS5）+ segmentCjk CJK 预分词：
   *   - 索引覆盖 user_message / assistant_message 的纯文本正文，不再搜序列化 JSON
   *   - FTS5 只负责检索 + bm25 排序（解决性能问题）；
   *     snippet 由 JS 从原始纯文本正文切，不依赖 FTS5 snippet() 在 contentless 表上
   *     不稳定的行为，且能保证 snippet 就是纯文本而非 JSON 乱码
   *   - 失败回退到 LIKE 全表扫描——升级过程中 FTS 表可能尚未建好或未回填完
   *
   * @param query 用户原始输入；特殊字符由 buildFtsMatchQuery 转义为 FTS5 短语
   */
  searchByContent(
    query: string,
    limit: number = 20,
  ): Array<{ sessionId: string; snippet: string }> {
    if (typeof query !== 'string' || query.trim().length === 0) return []

    // 优先走 FTS5。索引不可用 / MATCH 解析失败时回落到 LIKE 全表扫描。
    if (this.ensureSearchIndexAvailable()) {
      const match = buildFtsMatchQuery(query)
      if (match != null) {
        try {
          // FTS5 只负责检索 + 排序，回 event_id 再读原始正文切 snippet。
          // LIMIT 放大到 limit*5 给 session 去重留余量。
          const ftsRows = this.raw
            .prepare(
              `SELECT m.event_id AS eventId,
                      m.session_id AS sessionId,
                      bm25(agent_event_fts) AS rank
               FROM agent_event_fts
               JOIN agent_event_fts_map m ON m.rowid = agent_event_fts.rowid
               WHERE agent_event_fts MATCH ?
               ORDER BY rank
               LIMIT ? * 5`,
            )
            .all(match, limit) as Array<{
            eventId: string
            sessionId: string
            rank: number
          }>

          if (ftsRows.length > 0) {
            return this.buildSnippetsFromEvents(ftsRows, query, limit)
          }
          // FTS 命中为空时直接返回空——不要回落到 LIKE，那只会得到同样的空结果却多扫一遍全表
          return []
        } catch {
          // MATCH 语法异常（例如用户输入触发了 FTS5 解析边界）→ 落到 LIKE
        }
      }
    }

    return this.searchByContentFallback(query, limit)
  }

  /**
   * 把 FTS 命中的 event_id 列表转成带 snippet 的结果。
   *
   * 按 session 去重（保留相关度最高的一条），snippet 从原始事件正文切。
   * event_id 一次性 IN 查询，避免 N+1。
   */
  private buildSnippetsFromEvents(
    ftsRows: Array<{ eventId: string; sessionId: string; rank: number }>,
    query: string,
    limit: number,
  ): Array<{ sessionId: string; snippet: string }> {
    const eventIds = ftsRows.map((r) => r.eventId)
    const placeholders = eventIds.map(() => '?').join(',')
    const rows = this.raw
      .prepare(
        `SELECT id, session_id, event_type, event_json
         FROM agent_events
         WHERE id IN (${placeholders})`,
      )
      .all(...eventIds) as Array<{
      id: string
      session_id: string
      event_type: string
      event_json: string
    }>

    // event_id → 纯文本正文（只为 snippet 用；检索已由 FTS 完成）
    const bodyById = new Map<string, string>()
    for (const row of rows) {
      const body = extractSearchableEventBody(row.event_type, row.event_json)
      if (body != null) bodyById.set(row.id, body)
    }

    const seen = new Set<string>()
    const results: Array<{ sessionId: string; snippet: string }> = []
    for (const hit of ftsRows) {
      if (seen.has(hit.sessionId)) continue
      const body = bodyById.get(hit.eventId)
      if (body == null) continue
      seen.add(hit.sessionId)
      results.push({ sessionId: hit.sessionId, snippet: makeTextSnippet(body, query) })
      if (results.length >= limit) break
    }
    return results
  }

  /** LIKE 兜底：FTS 不可用、未回填完成或查询无法解析时使用 */
  private searchByContentFallback(
    query: string,
    limit: number,
  ): Array<{ sessionId: string; snippet: string }> {
    const pattern = `%${this.escapeLikePattern(query)}%`
    const stmt = this.raw.prepare(
      `SELECT DISTINCT session_id, event_type, event_json
       FROM agent_events
       WHERE event_json LIKE ? ESCAPE '\\'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    const rows = stmt.all(pattern, limit * 3) as AgentEventRow[]

    const seen = new Set<string>()
    const results: Array<{ sessionId: string; snippet: string }> = []
    for (const row of rows) {
      if (seen.has(row.session_id)) continue
      const body = extractSearchableEventBody(row.event_type, row.event_json)
      if (row.event_type === 'user_message' && body == null) continue
      seen.add(row.session_id)
      // 只在真正的对话正文里找匹配点——避免命中字段名/工具参数等 JSON 结构噪音
      const haystack = body ?? row.event_json
      if (!haystack.toLowerCase().includes(query.toLowerCase())) continue
      results.push({ sessionId: row.session_id, snippet: makeTextSnippet(haystack, query) })
      if (results.length >= limit) break
    }
    return results
  }

  /** 转义 LIKE 的通配符，让用户搜 `%` `_` 不会被当成通配符 */
  private escapeLikePattern(input: string): string {
    return input.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
  }

  /**
   * 回填存量事件的搜索索引（幂等）。
   *
   * 061 迁移只建表，不回填——回填需要 segmentCjk 分词，必须在 JS 侧分批做。
   * 标记写在 app_settings(session-search / ftsBackfillDone)，重复调用直接返回。
   *
   * **异步分批**：better-sqlite3 是同步 API，纯 while 循环会在万级事件量上
   * 阻塞 Electron main 进程数秒、UI 卡死。每批之间 yield 给事件循环（setTimeout 0），
   * 让 IPC/渲染保持响应。批大小 500 是 token 化 + 事务提交的吞吐与 yield 频次的折中。
   *
   * @returns 本次回填处理的事件数（已回填过则为 0）。
   */
  async backfillSearchIndexIfNeeded(): Promise<number> {
    if (!this.ensureSearchIndexAvailable()) return 0
    const settings = this.raw.prepare(
      `SELECT value FROM app_settings WHERE category = ? AND key = ?`,
    )
    const done = settings.get('session-search', 'ftsBackfillDone') as { value: string } | undefined
    if (done?.value === 'true') return 0

    const BACKFILL_BATCH = 500
    let lastEventId: string | null = null
    let processed = 0
    const scanStmt = this.raw.prepare(
      `SELECT id, session_id, event_type, event_json
       FROM agent_events
       WHERE event_type IN ('user_message', 'assistant_message')
         AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
    )
    const mapStmt = this.raw.prepare(
      `INSERT OR IGNORE INTO agent_event_fts_map (event_id, session_id) VALUES (?, ?)`,
    )
    const ftsStmt = this.raw.prepare(
      `INSERT OR REPLACE INTO agent_event_fts (rowid, body) VALUES (?, ?)`,
    )
    const lookupStmt = this.raw.prepare(`SELECT rowid FROM agent_event_fts_map WHERE event_id = ?`)

    while (true) {
      const rows = scanStmt.all(lastEventId ?? '', BACKFILL_BATCH) as Array<{
        id: string
        session_id: string
        event_type: string
        event_json: string
      }>
      if (rows.length === 0) break
      const tx = this.raw.transaction(() => {
        for (const row of rows) {
          lastEventId = row.id
          const body = extractSearchableEventBody(row.event_type, row.event_json)
          if (body == null) continue
          mapStmt.run(row.id, row.session_id)
          const mapped = lookupStmt.get(row.id) as { rowid: number } | undefined
          if (mapped == null) continue
          ftsStmt.run(mapped.rowid, segmentCjk(body))
          processed += 1
        }
      })
      tx()
      // yield 给事件循环：让 IPC/渲染保持响应，避免大库回填卡死 UI
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }

    const upsertSetting = this.raw.prepare(
      `INSERT INTO app_settings (category, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(category, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    upsertSetting.run('session-search', 'ftsBackfillDone', 'true', new Date().toISOString())
    return processed
  }
}

/**
 * 软保护倍率：turnLimit 个轮次的总可渲染事件数 ≤ eventLimit × 此倍率时，优先保证轮次
 * 完整性——全返回 turnIds，不被 eventLimit 切碎成更少的轮次（否则 agentic 会话单轮事件
 * 密集时，eventLimit 会先把 turnLimit 轮砍成最近寥寥几轮，违背按轮分页的初衷）。
 * 仅当超过此阈值（极端重密度会话，例如 12 轮累计数千条事件）才回退到按 eventLimit 累加
 * 砍轮，防止首屏一次性加载过多事件导致卡顿。
 */
const RENDERABLE_TURN_EVENT_SOFT_LIMIT_MULTIPLIER = 5

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
  const totalCount = turnIds.reduce((sum, turnId) => sum + (counts.get(turnId) ?? 0), 0)
  // 总事件数在软保护阈值内：优先满足 turnLimit 轮完整性，全返回，避免被 eventLimit 切碎。
  if (totalCount <= eventLimit * RENDERABLE_TURN_EVENT_SOFT_LIMIT_MULTIPLIER) {
    return turnIds
  }
  // 超过软保护阈值：按 eventLimit 从最近轮累加砍轮，防首屏一次性加载过多事件。
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
