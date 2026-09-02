/**
 * @module HistoryImport/zcodeCliStore
 *
 * zcode CLI 会话存储的只读访问层（~/.zcode/cli/db/db.sqlite）。
 *
 * zcode CLI 把会话存在单文件 SQLite（WAL 模式）中，核心三表：
 *   - session(id, directory, title, time_created, time_updated, ...)
 *   - message(id, session_id, data JSON, sequence)   data: {role, time, semantics, ...}
 *   - part(id, message_id, session_id, data JSON, sequence)
 *     data.type: text / reasoning / tool / step-start / step-finish / file / compaction
 *     （AI SDK 风格 part 流；另有 timelineType 类时间线噪声，忽略）
 *
 * 本模块只负责：枚举会话摘要 + 按会话重组 message/part 流并序列化为 JSON 文本，
 * 交给 zcodeCliParser 做纯函数解析（保持与 claude/codex parser 相同的可测形态）。
 *
 * 打开方式：better-sqlite3 readonly。zcode 运行中（WAL 有 -shm/-wal）可安全并发读；
 * 若打开失败（如 WAL 无 shm 且不可恢复），抛错由调用方将 CLI 通道标记不可用。
 * 该 schema 为 zcode 内部结构（schema_migration 演进中），所有读取均做容错：
 * 查询失败返回空/抛错，不损坏任何数据（连接只读，物理上不可写）。
 */

import BetterSqlite3 from 'better-sqlite3'

/** sqlite 会话摘要（scan 用轻量数据） */
export interface ZcodeCliSessionSummary {
  sessionId: string
  title: string | null
  cwd: string | null
  createdAt: number | null
  updatedAt: number | null
  /** 可见（非 hidden）user/assistant 消息数 */
  messageCount: number
}

/** 重组后的单条消息（data 原样 + parts 原样） */
export interface ZcodeCliMessagePayload {
  data: Record<string, unknown>
  parts: Array<Record<string, unknown>>
}

/** 重组后的单会话载荷（parser 输入） */
export interface ZcodeCliSessionPayload {
  meta: {
    sessionId: string
    title: string | null
    cwd: string | null
    createdAt: number | null
    updatedAt: number | null
    modelId: string | null
    providerId: string | null
  }
  messages: ZcodeCliMessagePayload[]
}

/**
 * 列出 zcode CLI 库中的全部会话摘要。
 * 库文件不存在返回 null（CLI 未安装/未使用）；打开或查询失败抛错（通道标记不可用）。
 */
export function listZcodeCliSessions(dbPath: string): ZcodeCliSessionSummary[] | null {
  const db = openReadonly(dbPath)
  if (db == null) return null
  try {
    const rows = db
      .prepare(
        `SELECT s.id AS id, s.title AS title, s.directory AS directory,
                s.time_created AS time_created, s.time_updated AS time_updated,
                (SELECT COUNT(*) FROM message m
                  WHERE m.session_id = s.id
                    AND json_extract(m.data, '$.role') IN ('user','assistant')
                    AND COALESCE(json_extract(m.data, '$.semantics.uiVisibility'), 'visible') != 'hidden'
                    AND COALESCE(json_extract(m.data, '$.synthetic'), 0) = 0
                    AND COALESCE(json_extract(m.data, '$.visibility'), '') != 'model-only'
                ) AS msg_count
         FROM session s`,
      )
      .all() as Array<{
      id: string
      title: string | null
      directory: string | null
      time_created: number | null
      time_updated: number | null
      msg_count: number
    }>
    return rows.map((r) => ({
      sessionId: r.id,
      title: r.title,
      cwd: r.directory,
      createdAt: r.time_created,
      updatedAt: r.time_updated,
      messageCount: r.msg_count,
    }))
  } finally {
    db.close()
  }
}

/**
 * 重组单个会话为 parser 载荷，并序列化为 JSON 文本。
 * 会话不存在返回 null；读取失败抛错。
 */
export function loadZcodeCliSessionText(dbPath: string, sessionId: string): string | null {
  const payload = loadZcodeCliSession(dbPath, sessionId)
  return payload == null ? null : JSON.stringify(payload)
}

/** loadZcodeCliSessionText 的结构化版本（测试可直接用） */
export function loadZcodeCliSession(dbPath: string, sessionId: string): ZcodeCliSessionPayload | null {
  const db = openReadonly(dbPath)
  if (db == null) return null
  try {
    const session = db
      .prepare(
        `SELECT id, title, directory, time_created, time_updated
         FROM session WHERE id = ?`,
      )
      .get(sessionId) as
      | { id: string; title: string | null; directory: string | null; time_created: number | null; time_updated: number | null }
      | undefined
    if (session == null) return null

    const messages = db
      .prepare(`SELECT id, data FROM message WHERE session_id = ? ORDER BY sequence`)
      .all(sessionId) as Array<{ id: string; data: string }>

    const parts = db
      .prepare(`SELECT message_id, data FROM part WHERE session_id = ? ORDER BY sequence`)
      .all(sessionId) as Array<{ message_id: string; data: string }>

    const partsByMessage = new Map<string, Array<Record<string, unknown>>>()
    for (const row of parts) {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(row.data) as Record<string, unknown>
      } catch {
        continue
      }
      // 只保留带 type 的流式 part；timelineType 类 UI 时间线条目无 type，忽略
      if (typeof parsed['type'] !== 'string') continue
      const list = partsByMessage.get(row.message_id)
      if (list != null) list.push(parsed)
      else partsByMessage.set(row.message_id, [parsed])
    }

    // 会话级 model/provider 取自最新一条 assistant 消息（用户切换模型后旧消息保留旧值）
    let modelId: string | null = null
    let providerId: string | null = null
    const messagePayloads: ZcodeCliMessagePayload[] = []
    for (const row of messages) {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(row.data) as Record<string, unknown>
      } catch {
        continue
      }
      const model = typeof data['modelID'] === 'string' ? (data['modelID'] as string) : null
      const provider = typeof data['providerID'] === 'string' ? (data['providerID'] as string) : null
      if (model != null || provider != null) {
        modelId = model
        providerId = provider
      }
      messagePayloads.push({ data, parts: partsByMessage.get(row.id) ?? [] })
    }

    return {
      meta: {
        sessionId: session.id,
        title: session.title,
        cwd: session.directory,
        createdAt: session.time_created,
        updatedAt: session.time_updated,
        modelId,
        providerId,
      },
      messages: messagePayloads,
    }
  } finally {
    db.close()
  }
}

/** readonly 打开；文件不存在返回 null，其余异常向上抛 */
function openReadonly(dbPath: string): BetterSqlite3.Database | null {
  try {
    return new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 未安装 / 未使用 zcode CLI：库文件不存在（SQLITE_CANTOPEN，
    // better-sqlite3 的 message 文案为 "unable to open database file"）不算错误
    if (
      msg.includes('does not exist') ||
      msg.includes('unable to open database file') ||
      msg.includes('SQLITE_CANTOPEN')
    ) {
      return null
    }
    throw err
  }
}
