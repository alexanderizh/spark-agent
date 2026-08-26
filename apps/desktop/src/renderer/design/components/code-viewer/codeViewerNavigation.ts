/**
 * 「打开项目进代码编辑器」的跨视图导航请求（侧栏项目菜单 -> ChatView「代码」面板）。
 *
 * 与 teamNavigation.ts / SkillStoreView 的 target-tab 同构：
 * localStorage 记录待处理请求 + window CustomEvent 即时通知。
 * 侧栏先 setTweak('view','chat') 再派发；若派发瞬间 ChatView 尚未挂载（用户
 * 此前在其他视图），事件落空，ChatView 挂载时消费存储的待处理请求兜底。
 * 标记带写入时间戳，超期视为残留（如应用在挂载前被杀），不再消费。
 */

export const OPEN_PROJECT_CODE_VIEWER_EVENT = 'spark:open-project-code-viewer'
export const OPEN_PROJECT_CODE_VIEWER_PENDING_KEY = 'spark-agent:open-project-code-viewer-pending'

/** 待处理标记有效期：点击到 ChatView 挂载远小于该窗口，超期视为残留。 */
const PENDING_TTL_MS = 30_000

/** 发起「打开项目」请求：写入带时间戳的待处理标记并即时派发事件。 */
export function requestOpenProjectCodeViewer(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(OPEN_PROJECT_CODE_VIEWER_PENDING_KEY, String(Date.now()))
  } catch {
    /* localStorage 不可用时仅靠事件通知 */
  }
  window.dispatchEvent(new CustomEvent(OPEN_PROJECT_CODE_VIEWER_EVENT))
}

/** 消费挂载前落下的待处理请求；超期残留同样清除但返回 false。 */
export function consumePendingOpenProjectCodeViewer(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(OPEN_PROJECT_CODE_VIEWER_PENDING_KEY)
    if (raw == null) return false
    window.localStorage.removeItem(OPEN_PROJECT_CODE_VIEWER_PENDING_KEY)
    const writtenAt = Number(raw)
    return Number.isFinite(writtenAt) && Date.now() - writtenAt <= PENDING_TTL_MS
  } catch {
    return false
  }
}

/** 事件即时到达时清除待处理标记，避免下次挂载重复打开。 */
export function clearPendingOpenProjectCodeViewer(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(OPEN_PROJECT_CODE_VIEWER_PENDING_KEY)
  } catch {
    /* ignore */
  }
}
