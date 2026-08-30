/**
 * browserChromeShared — 内置浏览器（统一侧边面板 / 独立窗口共用）的常量与纯函数。
 *
 * 会话右侧统一面板（UnifiedSessionSidePanel 的 browser tab）与独立窗口
 * （BrowserWindowApp）渲染的是同一套 BrowserChrome 组件，本模块承载两者
 * 共享的无状态逻辑与跨模块事件名，便于单测。
 */

export const DEFAULT_BROWSER_URL = 'https://spark.yiqibyte.com'

/**
 * 与 agent 控制的 spark_browser 窗口（主进程 `persist:spark-browser:<profileId>`
 * 分区）共享 default 分区：面板里登录的站点对 agent 浏览器窗口同样可见，
 * 反之亦然。
 */
export const SIDEBAR_PARTITION = 'persist:spark-browser:default'

/** 单个浏览器实例（面板或独立窗口）允许同时打开的最大 tab 数。 */
export const MAX_BROWSER_TABS = 8

/** 视口预设；width/height 为空表示「适应窗口」。 */
export interface BrowserViewportPreset {
  id: string
  label: string
  width?: number
  height?: number
}

export const VIEWPORT_FIT_ID = 'fit'

export const BROWSER_VIEWPORT_PRESETS: BrowserViewportPreset[] = [
  { id: VIEWPORT_FIT_ID, label: '适应窗口' },
  { id: 'mobile', label: '375 × 812', width: 375, height: 812 },
  { id: 'tablet', label: '768 × 1024', width: 768, height: 1024 },
  { id: 'laptop', label: '1280 × 720', width: 1280, height: 720 },
  { id: 'desktop', label: '1920 × 1080', width: 1920, height: 1080 },
]

/** Normalize a user-typed string into a loadable URL. */
export function normalizeBrowserUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return DEFAULT_BROWSER_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.\w{2,}/.test(trimmed)) return `https://${trimmed}`
  return `https://${trimmed}`
}

/** 空白新 tab 的初始地址（about:blank，等待用户在地址栏输入）。 */
export const BLANK_TAB_URL = 'about:blank'

/** 请求打开浏览器面板的窗口事件（可携带初始 URL；App.tsx / 各入口派发，ChatView 监听）。 */
export const BROWSER_PANEL_OPEN_EVENT = 'spark:browser:panel-open'

/** 浏览器面板请求收起（「在独立窗口中打开」成功后由 BrowserChrome 派发，ChatView 监听）。 */
export const BROWSER_PANEL_CLOSE_EVENT = 'spark:browser:panel-close'

/** 面板已挂载时的导航事件（ChatView 派发；BrowserChrome 面板形态监听并清 pending）。 */
export const BROWSER_PANEL_NAVIGATE_EVENT = 'spark:browser:panel-navigate'

/**
 * 待导航 URL：面板尚未挂载时（如独立窗口收回面板），先把 URL 存在这里，
 * BrowserChrome 面板形态挂载时消费并清空——避免事件早于监听器挂载而丢失。
 */
export const browserPanelPendingNavigate: { url: string | null } = { url: null }

/** 浏览器拾取元素 / 其他外部来源向会话输入框追加文本的窗口事件。 */
export const COMPOSER_APPEND_EXTERNAL_TEXT_EVENT = 'spark:composer:append-external-text'

/** 展示用：tab 标签上显示的短文案（标题优先，回退主机名 / 网址）。 */
export function tabDisplayLabel(tab: { title: string | null; url: string | null }): string {
  const title = tab.title?.trim()
  if (title != null && title.length > 0) return title
  const url = tab.url?.trim()
  if (url == null || url.length === 0 || url === BLANK_TAB_URL) return '新标签页'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
