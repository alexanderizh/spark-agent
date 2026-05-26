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
  /** 分页：取最近 N 个事件 */
  limit?: number
  /** 分页：游标（取 created_at < cursor 的事件） */
  beforeCreatedAt?: string
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

  /** 按 session 查询事件（支持分页） */
  queryBySession(params: QueryEventsParams): { events: AgentEventRow[]; hasMore: boolean } {
    const { sessionId, runId, turnId, eventType, limit = 50, beforeCreatedAt } = params

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

    const whereClause = `WHERE ${conditions.join(' AND ')}`

    // 多取一条判断是否有更多数据
    const stmt = this.raw.prepare(
      `SELECT * FROM agent_events ${whereClause} ORDER BY created_at ASC LIMIT ?`,
    )
    const rows = stmt.all(...args, limit + 1) as AgentEventRow[]

    const hasMore = rows.length > limit
    const events = hasMore ? rows.slice(0, limit) : rows

    return { events, hasMore }
  }

  /** 统计指定 session 的事件数量 */
  countBySession(sessionId: string): number {
    const stmt = this.raw.prepare(
      'SELECT COUNT(*) as count FROM agent_events WHERE session_id = ?',
    )
    const row = stmt.get(sessionId) as { count: number }
    return row.count
  }
}
