/**
 * 「打开内置浏览器面板」的跨视图导航请求（独立浏览器窗口收回面板 / 其他入口
 * -> ChatView 统一侧边面板的 browser tab）。
 *
 * 与 terminalPanelNavigation.ts 同构：localStorage 记录带时间戳的待处理请求
 * + window CustomEvent 即时通知。若派发瞬间 ChatView 尚未挂载（如用户在画布
 * 视图），事件落空，ChatView 挂载时消费存储的待处理请求兜底；超期视为残留。
 *
 * URL 随请求一并存储：ChatView 收到后经 browserPanelPendingNavigate 交给
 * BrowserChrome（未挂载时挂载消费；已挂载时 NAVIGATE 事件直接导航）。
 */
import {
  BROWSER_PANEL_NAVIGATE_EVENT,
  BROWSER_PANEL_OPEN_EVENT,
  browserPanelPendingNavigate,
} from '../../components/browser/browserChromeShared'
import { panelBrowserTabsStore } from '../../components/browser/browserTabsStore'

export const OPEN_BROWSER_PANEL_PENDING_KEY = 'spark-agent:open-browser-panel-pending'

/** 待处理标记有效期：触发到 ChatView 挂载远小于该窗口，超期视为残留。 */
const PENDING_TTL_MS = 30_000

type PendingOpenBrowserPanel = { url?: string; ts: number }

/** 发起「打开浏览器面板」请求：写入待处理标记并即时派发事件。 */
export function requestOpenBrowserPanel(url?: string): void {
  if (typeof window === 'undefined') return
  const payload: PendingOpenBrowserPanel = { ts: Date.now() }
  if (url != null && url.trim().length > 0) payload.url = url.trim()
  try {
    window.localStorage.setItem(OPEN_BROWSER_PANEL_PENDING_KEY, JSON.stringify(payload))
  } catch {
    /* localStorage 不可用时仅靠事件通知 */
  }
  window.dispatchEvent(new CustomEvent(BROWSER_PANEL_OPEN_EVENT, { detail: payload }))
}

/** 事件即时到达时清除待处理标记，避免下次挂载重复打开。 */
export function clearPendingOpenBrowserPanel(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(OPEN_BROWSER_PANEL_PENDING_KEY)
  } catch {
    /* ignore */
  }
}

/** 消费挂载前落下的待处理请求（含 URL）；无请求或超期残留返回 null。 */
export function consumePendingOpenBrowserPanel(): { url?: string } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(OPEN_BROWSER_PANEL_PENDING_KEY)
    if (raw == null) return null
    window.localStorage.removeItem(OPEN_BROWSER_PANEL_PENDING_KEY)
    const parsed = JSON.parse(raw) as Partial<PendingOpenBrowserPanel>
    if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > PENDING_TTL_MS) return null
    return typeof parsed.url === 'string' ? { url: parsed.url } : {}
  } catch {
    return null
  }
}

/**
 * 把 URL 交给浏览器面板：先落进面板 store（未挂载时首次渲染的 webview src
 * 即目标 URL——guest attach 前调用 loadURL 会同步 throw，不能依赖挂载后补导
 * 航），再派发 NAVIGATE 事件驱动已挂载的 BrowserChrome 立即导航并清 pending。
 */
export function handOffBrowserNavigate(url: string): void {
  const state = panelBrowserTabsStore.getState()
  const activeId = state.activeId ?? state.tabs[0]?.id ?? null
  if (activeId != null) {
    panelBrowserTabsStore.dispatch({ type: 'navigate', id: activeId, url })
  }
  browserPanelPendingNavigate.url = url
  window.dispatchEvent(new CustomEvent(BROWSER_PANEL_NAVIGATE_EVENT, { detail: { url } }))
}
