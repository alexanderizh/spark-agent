/**
 * @module HistoryImport/workbuddyStore
 *
 * WorkBuddy 会话元数据的只读访问层（~/.workbuddy/workbuddy.db）。
 *
 * WorkBuddy 的会话正文存放在 `~/.workbuddy/projects/<encoded-cwd>/<sessionId>.jsonl`，
 * 标题与 cwd 兜底元数据在 workbuddy.db 的 sessions 表（id/title/custom_title/cwd/
 * created_at/updated_at/deleted_at）。旧版 jsonl 行内可能没有 cwd，需靠该表补齐；
 * 同时在 WorkBuddy 内被删除（deleted_at 非空）的会话按不可导入处理。
 *
 * 打开方式：better-sqlite3 readonly（与 zcodeCliStore 同款）。库文件不存在或结构
 * 不符时返回 null，由调用方回落为「无元数据」（仅用 jsonl 自身信息），不阻断扫描。
 */

import BetterSqlite3 from 'better-sqlite3'

/** sessions 表里的单条会话元数据 */
export interface WorkbuddySessionMeta {
  sessionId: string
  title: string | null
  customTitle: string | null
  cwd: string | null
  /** 非空表示该会话已在 WorkBuddy 内删除 */
  deletedAt: number | null
}

/**
 * 读取全部会话元数据，返回 sessionId → meta 的映射。
 * 库文件不存在 / 表缺失 / 查询失败统一返回 null（视为无可用的兜底元数据）。
 */
export function loadWorkbuddySessions(dbPath: string): Map<string, WorkbuddySessionMeta> | null {
  let db: BetterSqlite3.Database
  try {
    db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
  } catch {
    return null
  }

  try {
    const rows = db
      .prepare('SELECT id, title, custom_title, cwd, deleted_at FROM sessions')
      .all() as Array<{
      id: unknown
      title: unknown
      custom_title: unknown
      cwd: unknown
      deleted_at: unknown
    }>

    const map = new Map<string, WorkbuddySessionMeta>()
    for (const row of rows) {
      if (typeof row.id !== 'string' || row.id.length === 0) continue
      map.set(row.id, {
        sessionId: row.id,
        title: typeof row.title === 'string' && row.title.trim().length > 0 ? row.title : null,
        customTitle:
          typeof row.custom_title === 'string' && row.custom_title.trim().length > 0
            ? row.custom_title
            : null,
        cwd: typeof row.cwd === 'string' && row.cwd.trim().length > 0 ? row.cwd : null,
        deletedAt: typeof row.deleted_at === 'number' ? row.deleted_at : null,
      })
    }
    return map
  } catch {
    return null
  } finally {
    db.close()
  }
}
