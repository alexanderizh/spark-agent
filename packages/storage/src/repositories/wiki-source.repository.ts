/**
 * @module wiki-source.repository
 *
 * Wiki 溯源（wiki_source）仓储 — 每条知识回链到原始轨迹的最小依据（方案 §9.4）。
 *
 * 强制溯源：抽取或导入产生的页面必须至少绑定一条来源；无来源拒绝入库。
 * 溯源只记"依据片段"（excerpt），不复制整段轨迹，避免知识库变成第二份日志。
 *
 * 主键陷阱（与 wiki_candidate.scope_ref 同类）：SQLite 复合主键里 NULL 互不相等，
 * 会让 UNIQUE 语义静默失效。因此本仓储对可空列统一写入非空哨兵
 * （session_id/tool_call_id 用 ''，turn_index 用 -1），保证同一页不会因
 * 空值绕过主键约束而写入重复来源行。
 */

import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'

/** 可空列的哨兵值（见文件头「主键陷阱」） */
const NULL_SESSION = ''
const NULL_TOOL_CALL = ''
const NULL_TURN_INDEX = -1

export interface WikiSourceInsert {
  pageId: string
  sessionId?: string | null
  turnIndex?: number | null
  toolCallId?: string | null
  excerpt: string
}

export interface WikiSourceRow {
  page_id: string
  session_id: string | null
  turn_index: number | null
  tool_call_id: string | null
  excerpt: string | null
  created_at: number
}

/** excerpt 上限：只存依据片段，不允许把整段轨迹抄进知识库 */
export const WIKI_SOURCE_EXCERPT_MAX_CHARS = 600

export class WikiSourceRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'wiki_source')
  }

  /** 幂等绑定一条来源（同主键重复写入静默跳过）。 */
  insert(row: WikiSourceInsert): void {
    this.raw
      .prepare(
        `INSERT OR IGNORE INTO wiki_source
           (page_id, session_id, turn_index, tool_call_id, excerpt, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.pageId,
        row.sessionId ?? NULL_SESSION,
        row.turnIndex ?? NULL_TURN_INDEX,
        row.toolCallId ?? NULL_TOOL_CALL,
        clipExcerpt(row.excerpt),
        Date.now(),
      )
  }

  /** 某页面的全部来源（按轮次排序， UI 展示"依据片段"）。 */
  listByPage(pageId: string): WikiSourceRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM wiki_source WHERE page_id = ?
         ORDER BY turn_index ASC, session_id ASC`,
      )
      .all(pageId) as WikiSourceRow[]
  }

  /** 某会话贡献了哪些页面（回溯"这段对话沉淀出了什么"）。 */
  listBySession(sessionId: string, limit = 100): WikiSourceRow[] {
    return this.raw
      .prepare(
        `SELECT * FROM wiki_source WHERE session_id = ?
         ORDER BY turn_index ASC LIMIT ?`,
      )
      .all(sessionId, limit) as WikiSourceRow[]
  }

  /** 该会话已被知识库引用的最大轮次（增量抽样的水位线）。 */
  maxTurnIndexBySession(sessionId: string): number | null {
    const row = this.raw
      .prepare(
        `SELECT MAX(turn_index) AS m FROM wiki_source WHERE session_id = ? AND turn_index >= 0`,
      )
      .get(sessionId) as { m: number | null }
    return row.m ?? null
  }

  /** 物理删除页面时清理来源行（删除屏障，WikiWriteService 专用）。 */
  deleteByPage(pageId: string): void {
    this.raw.prepare(`DELETE FROM wiki_source WHERE page_id = ?`).run(pageId)
  }
}

function clipExcerpt(excerpt: string): string {
  const normalized = excerpt.replace(/\s+/g, ' ').trim()
  return normalized.length <= WIKI_SOURCE_EXCERPT_MAX_CHARS
    ? normalized
    : normalized.slice(0, WIKI_SOURCE_EXCERPT_MAX_CHARS)
}
