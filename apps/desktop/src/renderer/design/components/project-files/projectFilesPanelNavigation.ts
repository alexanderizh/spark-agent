/**
 * 「打开项目文件面板」的跨视图导航请求（侧栏项目菜单 -> ChatView「文件」面板）。
 *
 * 与 codeViewerNavigation.ts / terminalPanelNavigation.ts 同构：
 * localStorage 记录待处理请求 + window CustomEvent 即时通知。
 * 侧栏先 setTweak('view','chat') 再派发；若派发瞬间 ChatView 尚未挂载（用户
 * 此前在其他视图），事件落空，ChatView 挂载时消费存储的待处理请求兜底。
 * 标记带写入时间戳，超期视为残留（如应用在挂载前被杀），不再消费。
 *
 * 与「打开项目进代码编辑器」的差异：文件面板可自行切换浏览的项目，无需先把
 * 目标项目设为会话激活项目，故待处理标记携带目标 workspaceId。
 */

export const OPEN_PROJECT_FILES_EVENT = 'spark:open-project-files'
export const OPEN_PROJECT_FILES_PENDING_KEY = 'spark-agent:open-project-files-pending'

/** 待处理标记有效期：点击到 ChatView 挂载远小于该窗口，超期视为残留。 */
const PENDING_TTL_MS = 30_000

export interface PendingOpenProjectFiles {
  workspaceId: string | null
}

/** 发起「打开项目文件面板」请求：写入带时间戳的待处理标记并即时派发事件。 */
export function requestOpenProjectFiles(workspaceId: string | null): void {
  if (typeof window === 'undefined') return
  try {
    const payload: PendingOpenProjectFiles & { writtenAt: number } = {
      workspaceId,
      writtenAt: Date.now(),
    }
    window.localStorage.setItem(OPEN_PROJECT_FILES_PENDING_KEY, JSON.stringify(payload))
  } catch {
    /* localStorage 不可用时仅靠事件通知 */
  }
  window.dispatchEvent(new CustomEvent(OPEN_PROJECT_FILES_EVENT))
}

/** 消费挂载前落下的待处理请求；超期残留同样清除但返回 null。 */
export function consumePendingOpenProjectFiles(): PendingOpenProjectFiles | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(OPEN_PROJECT_FILES_PENDING_KEY)
    if (raw == null) return null
    window.localStorage.removeItem(OPEN_PROJECT_FILES_PENDING_KEY)
    const parsed: unknown = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object') return null
    const record = parsed as { workspaceId?: unknown; writtenAt?: unknown }
    if (record.writtenAt != null) {
      const writtenAt = Number(record.writtenAt)
      if (!Number.isFinite(writtenAt) || Date.now() - writtenAt > PENDING_TTL_MS) return null
    }
    return {
      workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : null,
    }
  } catch {
    return null
  }
}

/** 事件即时到达时清除待处理标记，避免下次挂载重复打开。 */
export function clearPendingOpenProjectFiles(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(OPEN_PROJECT_FILES_PENDING_KEY)
  } catch {
    /* ignore */
  }
}
