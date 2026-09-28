/**
 * @module HistoryImport/qoderStore
 *
 * Qoder 会话存储的只读访问层（Electron userData 下的 main.sqlite）。
 *
 * Qoder 把会话存在单文件 SQLite（WAL 模式）中，两个核心表：
 *   - chat_sessions(session_id, title, cwd, session_kind, created_at(ms),
 *                   updated_at(ms), archived, deleted_at, ...)
 *     session_kind ∈ standard / sideChat / automationExecution
 *   - chat_session_messages(session_id, message_id, turn_id, sequence,
 *                           payload_json, status, source, ...)
 *     payload_json: user {role,text,timestamp,attachments} /
 *                   assistant {role,text,timestamp,parts[],tools[]},
 *                   parts[].type ∈ text / thinking / tool / hook
 *
 * 本模块只负责：枚举会话摘要 + 按会话重组消息流并序列化为 JSON 文本，
 * 交给 qoderParser 做纯函数解析（与其余来源 parser 相同的可测形态）。
 *
 * 默认只导入未删除的 standard 会话（排除侧聊与自动化执行会话）。
 * 打开方式：better-sqlite3 readonly；库文件不存在返回 null，查询失败返回 null，
 * 均不阻断其它来源的扫描。
 */

import BetterSqlite3 from 'better-sqlite3'

/** Qoder 会话摘要（scan 用轻量数据） */
export interface QoderSessionSummary {
  sessionId: string
  title: string
  cwd: string
  createdAt: number | null
  updatedAt: number | null
  /** user + assistant 消息数 */
  messageCount: number
}

/** 重组后的单条消息 */
export interface QoderMessagePayload {
  messageId: string
  sequence: number
  payload: Record<string, unknown>
}

/** 重组后的单会话载荷（parser 输入） */
export interface QoderSessionPayload {
  meta: {
    sessionId: string
    title: string
    cwd: string
    createdAt: number | null
    updatedAt: number | null
  }
  messages: QoderMessagePayload[]
}

/** 只导入未删除的 standard 会话（排除 sideChat / automationExecution） */
const QODER_SESSION_FILTER = "s.deleted_at IS NULL AND s.session_kind = 'standard'"

/**
 * 列出 Qoder 库中的可导入会话摘要。
 * 库文件不存在 / 表缺失 / 查询失败返回 null（来源视为不可用）。
 */
export function listQoderSessions(dbPath: string): QoderSessionSummary[] | null {
  const db = openReadonly(dbPath)
  if (db == null) return null
  try {
    const rows = db
      .prepare(
        `SELECT s.session_id AS session_id, s.title AS title, s.cwd AS cwd,
                s.created_at AS created_at, s.updated_at AS updated_at,
                (SELECT COUNT(*) FROM chat_session_messages m
                  WHERE m.session_id = s.session_id
                    AND json_extract(m.payload_json, '$.role') IN ('user','assistant')
                ) AS msg_count
         FROM chat_sessions s
         WHERE ${QODER_SESSION_FILTER}`,
      )
      .all() as Array<{
      session_id: unknown
      title: unknown
      cwd: unknown
      created_at: unknown
      updated_at: unknown
      msg_count: unknown
    }>

    const out: QoderSessionSummary[] = []
    for (const row of rows) {
      if (typeof row.session_id !== 'string' || row.session_id.length === 0) continue
      const count = typeof row.msg_count === 'number' ? row.msg_count : 0
      if (count === 0) continue
      out.push({
        sessionId: row.session_id,
        title: typeof row.title === 'string' ? row.title : '',
        cwd: typeof row.cwd === 'string' ? row.cwd : '',
        createdAt: typeof row.created_at === 'number' ? row.created_at : null,
        updatedAt: typeof row.updated_at === 'number' ? row.updated_at : null,
        messageCount: count,
      })
    }
    return out
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** 重组单个会话为 parser 载荷，并序列化为 JSON 文本。会话不存在返回 null。 */
export function loadQoderSessionText(dbPath: string, sessionId: string): string | null {
  const payload = loadQoderSession(dbPath, sessionId)
  return payload == null ? null : JSON.stringify(payload)
}

/** loadQoderSessionText 的结构化版本（测试可直接用） */
export function loadQoderSession(dbPath: string, sessionId: string): QoderSessionPayload | null {
  const db = openReadonly(dbPath)
  if (db == null) return null
  try {
    const session = db
      .prepare(
        `SELECT session_id, title, cwd, created_at, updated_at
         FROM chat_sessions WHERE session_id = ?`,
      )
      .get(sessionId) as
      | {
          session_id: string
          title: unknown
          cwd: unknown
          created_at: unknown
          updated_at: unknown
        }
      | undefined
    if (session == null) return null

    const rows = db
      .prepare(
        `SELECT message_id, sequence, payload_json
         FROM chat_session_messages WHERE session_id = ? ORDER BY sequence`,
      )
      .all(sessionId) as Array<{ message_id: unknown; sequence: unknown; payload_json: unknown }>

    const messages: QoderMessagePayload[] = []
    for (const row of rows) {
      if (typeof row.payload_json !== 'string') continue
      let payload: Record<string, unknown>
      try {
        const parsed = JSON.parse(row.payload_json) as unknown
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
        payload = parsed as Record<string, unknown>
      } catch {
        continue
      }
      messages.push({
        messageId: typeof row.message_id === 'string' ? row.message_id : '',
        sequence: typeof row.sequence === 'number' ? row.sequence : 0,
        payload,
      })
    }

    return {
      meta: {
        sessionId: session.session_id,
        title: typeof session.title === 'string' ? session.title : '',
        cwd: typeof session.cwd === 'string' ? session.cwd : '',
        createdAt: typeof session.created_at === 'number' ? session.created_at : null,
        updatedAt: typeof session.updated_at === 'number' ? session.updated_at : null,
      },
      messages,
    }
  } catch {
    return null
  } finally {
    db.close()
  }
}

/** readonly 打开；文件不存在或打开失败返回 null（来源不可用） */
function openReadonly(dbPath: string): BetterSqlite3.Database | null {
  try {
    return new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
}
