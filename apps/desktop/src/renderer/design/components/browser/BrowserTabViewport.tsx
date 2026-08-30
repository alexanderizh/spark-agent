/**
 * BrowserTabViewport — 单个 tab 的 <webview> 及其事件接线。
 *
 * 所有 tab 常驻挂载（非活动的 display:none 隐藏），切换 tab 不丢页面状态。
 * webview 的 src/partition 只在首次挂载时设置；src 直接取 store 里的真实
 * URL（guest attach 前调用 loadURL/reload 会同步 throw，因此不依赖挂载后
 * 再导航），dom-ready 后若 store 落后/超前再做一次对齐。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { SIDEBAR_PARTITION, tabDisplayLabel } from './browserChromeShared'
import type { BrowserTabItem } from './browserTabsStore'

export interface BrowserNavState {
  canBack: boolean
  canForward: boolean
}

export interface BrowserTabViewportProps {
  tab: BrowserTabItem
  visible: boolean
  /** 固定视口尺寸（设备预设）；null = 适应容器 */
  fixedViewport: { width: number; height: number } | null
  /** webview 挂载/卸载时回调，供外层维护 tabId → webview 映射 */
  onWebviewReady: (tabId: string, webview: Electron.WebviewTag | null) => void
  onMeta: (
    tabId: string,
    meta: { url?: string | null; title?: string | null; favicon?: string | null },
  ) => void
  onNavState: (tabId: string, state: BrowserNavState) => void
  /** guest 完成 attach，可安全读取 webContentsId */
  onGuestReady: (tabId: string) => void
  /** 活动页面发生导航（用于退出拾取模式） */
  onDidNavigate: (tabId: string) => void
}

/**
 * webview guest 未 attach 时调用 reload/loadURL 等方法会同步 throw
 * （"The WebView must be attached to the DOM"）。包一层只记日志不冒泡，
 * 避免炸到全局 window.onerror 弹「页面遇到异常」toast。
 */
function callWebviewSafely(webview: Electron.WebviewTag, action: () => void): boolean {
  try {
    action()
    return true
  } catch (err) {
    console.warn(`[browser] webview call failed (guest not ready?): ${String(err)}`)
    return false
  }
}

export function BrowserTabViewport({
  tab,
  visible,
  fixedViewport,
  onWebviewReady,
  onMeta,
  onNavState,
  onGuestReady,
  onDidNavigate,
}: BrowserTabViewportProps): ReactElement {
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  // webview 的 src 只在首次挂载时设置（后续导航走事件对齐），记录初始值
  const initialUrlRef = useRef<string | null>(null)
  if (initialUrlRef.current == null) initialUrlRef.current = tab.url
  // 回调每次渲染都会变；用 ref 转发，避免 effect 反复摘挂事件监听
  const handlersRef = useRef({ onMeta, onNavState, onGuestReady, onDidNavigate })
  handlersRef.current = { onMeta, onNavState, onGuestReady, onDidNavigate }
  // 最新 tab.url：dom-ready 补偿对齐时读取（避免闭包拿到旧值）
  const tabUrlRef = useRef(tab.url)
  tabUrlRef.current = tab.url
  // guest 是否完成 attach（dom-ready 之后 webview 方法才可靠可调）
  const [loadError, setLoadError] = useState<{ code: number; desc: string } | null>(null)

  useEffect(() => {
    const wv = webviewRef.current
    if (wv == null) return
    onWebviewReady(tab.id, wv)

    const syncNav = (): void => {
      try {
        handlersRef.current.onNavState(tab.id, {
          canBack: wv.canGoBack(),
          canForward: wv.canGoForward(),
        })
      } catch {
        handlersRef.current.onNavState(tab.id, { canBack: false, canForward: false })
      }
    }
    const onNavigate = (event: Event, url?: string): void => {
      handlersRef.current.onMeta(tab.id, { url: url ?? wv.getURL() })
      handlersRef.current.onDidNavigate(tab.id)
      setLoadError(null)
      syncNav()
    }
    const onInPage = (event: Event, url?: string): void => {
      handlersRef.current.onMeta(tab.id, { url: url ?? wv.getURL() })
      syncNav()
    }
    const onTitle = (event: Event, title?: string): void => {
      handlersRef.current.onMeta(tab.id, { title: title ?? wv.getTitle() })
    }
    const onFavicon = (event: Event, favicons?: string[]): void => {
      handlersRef.current.onMeta(tab.id, { favicon: favicons?.[0] ?? null })
    }
    const onFailLoad = (
      event: Event,
      errorCode?: number,
      errorDescription?: string,
      validatedURL?: string,
      isMainFrame?: boolean,
    ): void => {
      // 子资源失败不整页提示；ERR_ABORTED(-3) 是导航被新导航/用户操作取消，非错误
      if (isMainFrame === false || errorCode === -3) return
      setLoadError({
        code: errorCode ?? -1,
        desc: errorDescription ?? '未知错误',
      })
      syncNav()
    }
    const onDomReady = (): void => {
      syncNav()
      handlersRef.current.onGuestReady(tab.id)
      // 补偿对齐：store 里的目标 URL 与 guest 实际 URL 不一致时（挂载早期的
      // loadURL 因未 attach 失败、或 pending 导航发生在挂载前），现在补一次。
      const target = tabUrlRef.current
      let current: string
      try {
        current = wv.getURL()
      } catch {
        return
      }
      if (target != null && target !== '' && target !== 'about:blank' && current !== target) {
        callWebviewSafely(wv, () => {
          void wv.loadURL(target).catch(() => {})
        })
      }
    }
    const onLoadStop = (): void => {
      syncNav()
    }

    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onInPage)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('page-favicon-updated', onFavicon)
    wv.addEventListener('did-fail-load', onFailLoad)
    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-stop-loading', onLoadStop)
    // 页面 window.open / target=_blank 由主进程 web-contents-created 统一路由：
    // deny 并按宿主窗口推送 stream:browser-panel:open-tab（见 BrowserPanelWindowService）

    return () => {
      onWebviewReady(tab.id, null)
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onInPage)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('page-favicon-updated', onFavicon)
      wv.removeEventListener('did-fail-load', onFailLoad)
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-stop-loading', onLoadStop)
    }
  }, [tab.id, onWebviewReady])

  const viewportStyle =
    fixedViewport != null ? { width: fixedViewport.width, height: fixedViewport.height } : undefined

  return (
    <div
      className={`browser-tab-viewport${visible ? ' is-active' : ''}`}
      data-tab-id={tab.id}
      style={viewportStyle}
    >
      <webview
        ref={webviewRef as React.LegacyRef<Electron.WebviewTag>}
        src={initialUrlRef.current}
        className="browser-tab-webview"
        partition={SIDEBAR_PARTITION}
        allowpopups={true}
      />
      {loadError != null && (
        <div className="browser-tab-loaderror" role="alert">
          <div className="browser-tab-loaderror-title">页面加载失败</div>
          <div className="browser-tab-loaderror-desc">
            {tabDisplayLabel(tab)} · {loadError.desc}（{loadError.code}）
          </div>
          <button
            type="button"
            className="browser-tab-loaderror-retry"
            onClick={() => {
              setLoadError(null)
              const wv2 = webviewRef.current
              if (wv2 != null) callWebviewSafely(wv2, () => wv2.reload())
            }}
          >
            重试
          </button>
        </div>
      )}
    </div>
  )
}

export { callWebviewSafely }
