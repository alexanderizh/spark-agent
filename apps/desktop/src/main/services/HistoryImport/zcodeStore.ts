/**
 * @module HistoryImport/zcodeStore
 *
 * ZCode CLI 会话库（~/.zcode/cli/db/db.sqlite）的只读访问层。
 *
 * ZCode 用中央 SQLite 存储（session/message/part 三级规范化表，风格接近 opencode）：
 *   - session 行：directory(工作目录) / title / title_source / revert(rewind 分支记录) /
 *     task_type('interactive' | 'subagent_child' | 'selection_side_chat')
 *   - message 行：data(JSON 信封) + sequence(全会话单调追加序号，rewind 后不重用)
 *   - part 行：message 的内容块（text/reasoning/tool/...），data(JSON) + sequence
 *
 * 本层只做查询与 JSON 反序列化，不做事件映射（见 zcodeParser）。
 * 只读打开（readonly + busy_timeout）：ZCode 正在运行时 WAL 允许并发读，不锁库。
 * schema 演进防御：查询抛错由上层置 available:false，不影响其他导入来源。
 */

import Database from 'better-sqlite3'
import type { ZcodeMessageRow, ZcodeRevert } from './zcodeParser.js'

/** ZCode 只导出主线程会话；subagent 子会话（task_type='subagent_child'）对齐
 *  claude-code 适配器的「只保留主线程」策略，不导入 */
const IMPORTABLE_TASK_TYPES = ['interactive', 'selection_side_chat'] as const

export interface ZcodeSessionRow {
  id: string
  /** 工作目录绝对路径 */
  directory: string | null
  title: string | null
  titleSource: string | null
  /** epoch ms */
  timeCreated: number
  /** epoch ms */
  timeUpdated: number
  messageCount: number
  /** rewind 分支记录（revert 列 JSON；无则为 null） */
  revert: ZcodeRevert | null
}

/** 只读打开 ZCode 会话库。文件不存在 / 无法打开（含需要 recovery 的 WAL）时抛错，由上层捕获。 */
export function openZcodeDb(dbPath: string): Database.Database {
  return new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 5_000 })
}

/** 确认所需表存在（schema 演进防御；缺表抛错） */
export function assertZcodeSchema(db: Database.Database): void {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('session', 'message', 'part')`,
    )
    .get() as { n: number } | undefined
  if (row == null || row.n < 3) {
    throw new Error('ZCode 数据库缺少 session/message/part 表（schema 版本不兼容）')
  }
}

function parseJsonColumn<T>(raw: unknown): T | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** 列出可导入会话（主线程类型），按最近活跃排序 */
export function listZcodeSessions(db: Database.Database): ZcodeSessionRow[] {
  const placeholders = IMPORTABLE_TASK_TYPES.map(() => '?').join(',')
  const sessions = db
    .prepare(
      `SELECT id, directory, title, title_source, time_created, time_updated, revert
         FROM session
        WHERE task_type IN (${placeholders})
        ORDER BY time_updated DESC`,
    )
    .all(...IMPORTABLE_TASK_TYPES) as Array<{
    id: string
    directory: string | null
    title: string | null
    title_source: string | null
    time_created: number | null
    time_updated: number | null
    revert: string | null
  }>

  const counts = new Map<string, number>()
  for (const row of db
    .prepare(`SELECT session_id, COUNT(*) AS c FROM message GROUP BY session_id`)
    .all() as Array<{ session_id: string; c: number }>) {
    counts.set(row.session_id, row.c)
  }

  return sessions.map((s) => ({
    id: s.id,
    directory: s.directory,
    title: s.title,
    titleSource: s.title_source,
    timeCreated: s.time_created ?? 0,
    timeUpdated: s.time_updated ?? 0,
    messageCount: counts.get(s.id) ?? 0,
    revert: parseJsonColumn<ZcodeRevert>(s.revert),
  }))
}

/** scan 阶段点查少量消息的 sequence/时间（计算分支条目元数据，避免载入全会话） */
export function lookupZcodeMessageMeta(
  db: Database.Database,
  sessionId: string,
  messageIds: string[],
): Map<string, { sequence: number; timeCreated: number }> {
  const out = new Map<string, { sequence: number; timeCreated: number }>()
  if (messageIds.length === 0) return out
  const placeholders = messageIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, sequence, time_created FROM message
        WHERE session_id = ? AND id IN (${placeholders})`,
    )
    .all(sessionId, ...messageIds) as Array<{
    id: string
    sequence: number | null
    time_created: number | null
  }>
  for (const r of rows) {
    out.set(r.id, { sequence: r.sequence ?? 0, timeCreated: r.time_created ?? 0 })
  }
  return out
}

/** 载入单个会话的全部消息与内容块（均按 sequence 排序；单会话最大数千条，可整载） */
export function loadZcodeMessages(db: Database.Database, sessionId: string): ZcodeMessageRow[] {
  const messages = db
    .prepare(
      `SELECT id, sequence, time_created, data FROM message
        WHERE session_id = ? ORDER BY sequence ASC`,
    )
    .all(sessionId) as Array<{
    id: string
    sequence: number | null
    time_created: number | null
    data: string | null
  }>

  const parts = db
    .prepare(
      `SELECT message_id, sequence, data FROM part
        WHERE session_id = ? ORDER BY sequence ASC`,
    )
    .all(sessionId) as Array<{
    message_id: string
    sequence: number | null
    data: string | null
  }>

  const partsByMessage = new Map<string, ZcodeMessageRow['parts']>()
  for (const p of parts) {
    const list = partsByMessage.get(p.message_id)
    const parsed = parseJsonColumn<ZcodeMessageRow['parts'][number]>(p.data) ?? {}
    if (list != null) list.push(parsed)
    else partsByMessage.set(p.message_id, [parsed])
  }

  return messages.map((m) => ({
    id: m.id,
    sequence: m.sequence ?? 0,
    timeCreated: m.time_created ?? 0,
    data: parseJsonColumn<ZcodeMessageRow['data']>(m.data) ?? {},
    parts: partsByMessage.get(m.id) ?? [],
  }))
}

/** 会话级元信息（title/cwd/directory 直出，供 parse params 使用） */
export function getZcodeSessionInfo(
  db: Database.Database,
  sessionId: string,
): { title: string | null; directory: string | null; revert: ZcodeRevert | null } | null {
  const row = db
    .prepare(`SELECT title, directory, revert FROM session WHERE id = ?`)
    .get(sessionId) as
    | { title: string | null; directory: string | null; revert: string | null }
    | undefined
  if (row == null) return null
  return {
    title: row.title,
    directory: row.directory,
    revert: parseJsonColumn<ZcodeRevert>(row.revert),
  }
}
