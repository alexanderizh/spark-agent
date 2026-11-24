/**
 * 远程项目面板的产物聚合（getProjectArtifacts 的纯逻辑部分，零 DB 依赖，便于单测）。
 *
 * 2026-11-25 修复「面板恒为 0」：此前只认 presented_files 事件，而聊天里的文件
 * 卡片多来自 file_change——目标机 DB 里两者都有，聚合却只扫一种。现在对齐本地
 * journey 口径（registerSessionJourneyIpc）：file_change + presented_files 两个
 * 事件源按路径去重合并；file_change 仅收集 isJourneyArtifactPath 白名单内的
 * 文档/多媒体扩展名，presented_files 是显式交付不过滤（与聊天侧行为一致）。
 */

import type { MobileBridgeProjectArtifactItem } from '@spark/protocol'
import { isJourneyArtifactPath } from './session-journey-helpers.js'

/** 事件扫描窗口：最近 20 个活跃会话（与旧行为一致，避免老项目全表扫事件） */
export const PROJECT_ARTIFACT_SESSION_WINDOW = 20

/** 单一事件源扫描上限；触达即置 truncated 提示控制端可能有更早产物 */
export const PROJECT_ARTIFACT_EVENT_LIMIT = 300

/** agent_events 行的投影（SQL 层只取聚合需要的列） */
export interface ProjectArtifactEventRow {
  session_id: string
  event_json: string
  created_at: string
}

/** SQLite 'YYYY-MM-DD HH:mm:ss' → ISO UTC；已是 ISO 的行原样返回 */
function normalizeSqliteTimestampUtc(value: string): string {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
}

const ARTIFACT_CHANGE_TYPES = new Set(['create', 'modify', 'delete'])

/** 单次触碰：同一文件在某事件行里出现一次（path 直接带在触碰上，便于归并） */
type ArtifactTouch =
  | { kind: 'presented'; path: string; title: string | null; row: ProjectArtifactEventRow }
  | { kind: 'change'; path: string; changeType: string | null; row: ProjectArtifactEventRow }

function parseEventPayload(row: ProjectArtifactEventRow): Record<string, unknown> | null {
  try {
    const payload: unknown = JSON.parse(row.event_json)
    return payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function collectChangeTouches(row: ProjectArtifactEventRow): ArtifactTouch[] {
  const payload = parseEventPayload(row)
  if (payload == null) return []
  const filePath = payload.path
  if (typeof filePath !== 'string' || filePath.length === 0) return []
  // 过程产物只收文档/多媒体扩展名（本地 journey 同口径），代码/配置不进清单
  if (!isJourneyArtifactPath(filePath)) return []
  const rawChangeType = payload.changeType
  const changeType =
    typeof rawChangeType === 'string' && ARTIFACT_CHANGE_TYPES.has(rawChangeType)
      ? rawChangeType
      : null
  return [{ kind: 'change', path: filePath, changeType, row }]
}

function collectPresentedTouches(row: ProjectArtifactEventRow): ArtifactTouch[] {
  const payload = parseEventPayload(row)
  if (payload == null) return []
  const rawFiles = payload.files
  if (!Array.isArray(rawFiles)) return []
  const touches: ArtifactTouch[] = []
  for (const file of rawFiles) {
    if (file == null || typeof file !== 'object') continue
    const record = file as Record<string, unknown>
    const filePath = record.path
    if (typeof filePath !== 'string' || filePath.length === 0) continue
    const title = record.title
    touches.push({
      kind: 'presented',
      path: filePath,
      title: typeof title === 'string' && title.length > 0 ? title : null,
      row,
    })
  }
  return touches
}

export interface MergeProjectArtifactsInput {
  projectId: string
  /** 会话 id → 标题（SQL 层已按活跃窗口裁剪） */
  titleBySession: Map<string, string>
  /** presented_files 源事件行（created_at 原文，排序无关紧要） */
  presentedRows: ProjectArtifactEventRow[]
  /** file_change 源事件行（created_at 原文） */
  fileChangeRows: ProjectArtifactEventRow[]
}

/**
 * 两个事件源按路径去重合并：同路径取「最近一次触碰」（时间相同则显式交付优先）
 * 归属会话；标题取最近一次显式交付的 title；变更类型取并集。
 */
export function mergeProjectArtifacts(input: MergeProjectArtifactsInput): {
  projectId: string
  artifacts: MobileBridgeProjectArtifactItem[]
  truncated?: boolean
} {
  const truncated =
    input.presentedRows.length >= PROJECT_ARTIFACT_EVENT_LIMIT ||
    input.fileChangeRows.length >= PROJECT_ARTIFACT_EVENT_LIMIT

  const touchesByPath = new Map<string, ArtifactTouch[]>()
  const collect = (touches: ArtifactTouch[]): void => {
    for (const touch of touches) {
      const list = touchesByPath.get(touch.path)
      if (list != null) list.push(touch)
      else touchesByPath.set(touch.path, [touch])
    }
  }
  for (const row of input.fileChangeRows) collect(collectChangeTouches(row))
  for (const row of input.presentedRows) collect(collectPresentedTouches(row))

  const items: MobileBridgeProjectArtifactItem[] = []
  for (const [filePath, touches] of touchesByPath) {
    // 赢家 = 最近一次触碰；时间相同显式交付优先（归属会话以它为准）
    const winner = touches.reduce((best, cur) => {
      if (cur.row.created_at > best.row.created_at) return cur
      if (cur.row.created_at === best.row.created_at && cur.kind === 'presented') return cur
      return best
    })
    const titledTouch = touches.find((t) => t.kind === 'presented' && t.title != null)
    const changeTypes = new Set<string>()
    for (const touch of touches) {
      if (touch.kind === 'change' && touch.changeType != null) changeTypes.add(touch.changeType)
    }
    items.push({
      path: filePath,
      ...(titledTouch != null && titledTouch.kind === 'presented' && titledTouch.title != null
        ? { title: titledTouch.title }
        : {}),
      sessionId: winner.row.session_id,
      sessionTitle: input.titleBySession.get(winner.row.session_id) ?? '未命名会话',
      presentedAt: normalizeSqliteTimestampUtc(winner.row.created_at),
      presented: touches.some((t) => t.kind === 'presented'),
      ...(changeTypes.size > 0 ? { changeTypes: [...changeTypes] } : {}),
    })
  }

  items.sort((a, b) => (a.presentedAt < b.presentedAt ? 1 : a.presentedAt > b.presentedAt ? -1 : 0))

  return {
    projectId: input.projectId,
    artifacts: items,
    ...(truncated ? { truncated: true } : {}),
  }
}
