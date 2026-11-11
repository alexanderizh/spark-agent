import type { SqliteDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'

const log = createLogger('mobile-bridge:session-preview')
const WARNING_INTERVAL_MS = 60_000
let lastWarningAt = 0

interface SessionPreviewRow {
  session_id: string
  event_json?: string
}

export function readSessionPreviews(
  db: SqliteDatabase,
  sessionIds: readonly string[],
): Map<string, string> {
  const previews = new Map<string, string>()
  if (sessionIds.length === 0) return previews

  try {
    const placeholders = sessionIds.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT session_id, event_json FROM (
           SELECT session_id, event_json,
                  ROW_NUMBER() OVER (
                    PARTITION BY session_id
                    ORDER BY created_at DESC, rowid DESC
                  ) AS preview_rank
           FROM agent_events
           WHERE event_type = 'user_message'
             AND session_id IN (${placeholders})
         ) WHERE preview_rank = 1`,
      )
      .all(...sessionIds) as SessionPreviewRow[]

    for (const row of rows) {
      try {
        if (row.event_json == null) continue
        const parsed = JSON.parse(row.event_json) as { content?: string }
        previews.set(
          row.session_id,
          (parsed.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
        )
      } catch {
        /* 单条预览解析失败按空内容处理 */
      }
    }
  } catch (error) {
    const now = Date.now()
    if (now - lastWarningAt >= WARNING_INTERVAL_MS) {
      lastWarningAt = now
      const detail = error instanceof Error ? `: ${error.message}` : ''
      log.warn(`mobile bridge session preview batch query failed${detail}`)
    }
  }

  return previews
}
