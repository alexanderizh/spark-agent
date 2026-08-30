/**
 * BrowserChrome — 内置浏览器外壳（多 tab + 工具栏 + 视口区）。
 *
 * 同一套组件服务两种宿主：
 *   - variant="panel"  会话右侧统一面板的 browser tab（store 为模块单例，
 *                      tab 状态在面板卸载/重挂间保留）
 *   - variant="window" 独立窗口（BrowserWindowApp，store 为窗口私有实例）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useToast } from '../Toast'
import { callWebviewSafely } from './BrowserTabViewport'
import {
  BLANK_TAB_URL,
  BROWSER_VIEWPORT_PRESETS,
  BROWSER_PANEL_CLOSE_EVENT,
  BROWSER_PANEL_NAVIGATE_EVENT,
  COMPOSER_APPEND_EXTERNAL_TEXT_EVENT,
  MAX_BROWSER_TABS,
  VIEWPORT_FIT_ID,
  browserPanelPendingNavigate,
  normalizeBrowserUrl,
} from './browserChromeShared'
import { buildElementReference, type ElementPickInfo } from './elementPickerScript'
import { useBrowserTabs, type BrowserTabsStore } from './browserTabsStore'
import { BrowserTabsBar } from './BrowserTabsBar'
import { BrowserToolbar } from './BrowserToolbar'
import { BrowserTabViewport, type BrowserNavState } from './BrowserTabViewport'
import { BrowserDevtoolsPanel } from './BrowserDevtoolsPanel'
import { useElementPicker } from './useElementPicker'
import { useBrowserPanelDevtools } from './useBrowserPanelDevtools'
import './browser-chrome.less'

export interface BrowserChromeProps {
  variant: 'panel' | 'window'
  store: BrowserTabsStore
}

export function BrowserChrome({ variant, store }: BrowserChromeProps): ReactElement {
  const { toast } = useToast()
  const state = useBrowserTabs(store)
  const activeTab = useMemo(
    () => state.tabs.find((tab) => tab.id === state.activeId) ?? null,
    [state.tabs, state.activeId],
  )

  const [urlInput, setUrlInput] = useState('')
  const [navStates, setNavStates] = useState<Record<string, BrowserNavState>>({})
  const [viewportPresetId, setViewportPresetId] = useState<string>(VIEWPORT_FIT_ID)
  const browserRootRef = useRef<HTMLDivElement | null>(null)
  const webviewRefs = useRef(new Map<string, Electron.WebviewTag>())
  const urlInputFocusedRef = useRef(false)

  // 地址栏跟随活动 tab 的 URL（用户正在输入时不覆盖）
  useEffect(() => {
    if (urlInputFocusedRef.current) return
    const url = activeTab?.url ?? ''
    setUrlInput(url === BLANK_TAB_URL ? '' : url)
  }, [activeTab?.url, state.activeId])

  const activeWebview = useCallback((): Electron.WebviewTag | null => {
    if (state.activeId == null) return null
    return webviewRefs.current.get(state.activeId) ?? null
  }, [state.activeId])

  const navigateActive = useCallback(
    (rawUrl: string): void => {
      const tab = activeTab
      if (tab == null) return
      const url = normalizeBrowserUrl(rawUrl)
      store.dispatch({ type: 'navigate', id: tab.id, url })
      const wv = webviewRefs.current.get(tab.id)
      if (wv != null) {
        // guest 未 attach 时 loadURL 同步 throw；此时 URL 已落 store，
        // dom-ready 的补偿对齐会在 guest 就绪后补一次导航。
        callWebviewSafely(wv, () => {
          void wv.loadURL(url).catch(() => {})
        })
      }
    },
    [activeTab, store],
  )

  // ─── 元素拾取：结果作为引用 tag 加入会话输入框 ────────────────────────
  const handlePickedElement = useCallback(
    (info: ElementPickInfo): void => {
      const reference = buildElementReference(info)
      if (variant === 'panel') {
        window.dispatchEvent(
          new CustomEvent(COMPOSER_APPEND_EXTERNAL_TEXT_EVENT, { detail: { reference } }),
        )
      } else {
        void window.spark
          .invoke('browser-panel:pick-to-composer', {
            referenceJson: JSON.stringify(reference),
          })
          .catch(() => toast.warning('未能加入会话输入框，请确认主窗口已打开'))
      }
    },
    [variant, toast],
  )

  const picker = useElementPicker({
    getWebview: activeWebview,
    onPickedElement: handlePickedElement,
    onPickError: (message) => toast.info(message),
  })
  const handleDevtoolsOpenError = useCallback((): void => {
    toast.warning('当前页面无法打开控制面板')
  }, [toast])
  const devtools = useBrowserPanelDevtools({
    activeTabId: state.activeId,
    browserRootRef,
    getActiveWebview: activeWebview,
    onOpenError: handleDevtoolsOpenError,
  })

  // 切换 tab / 活动页导航时退出拾取模式（脚本上下文已失效）
  const handleSelectTab = useCallback(
    (id: string): void => {
      picker.stop()
      store.dispatch({ type: 'select', id })
    },
    [picker, store],
  )
  const handleDidNavigate = useCallback(
    (tabId: string): void => {
      if (tabId === state.activeId) picker.stop()
    },
    [picker, state.activeId],
  )

  // ─── 外部导航请求 ────────────────────────────────────────────────────
  // 面板形态随统一侧边面板 tab 切换而卸载重挂：挂载时消费待导航 URL（独立
  // 窗口收回面板时 ChatView 已把导航落进 store，首次渲染的 src 即目标 URL；
  // 这里只处理仍残留的 pending，导航交给 store 驱动）。
  useEffect(() => {
    if (variant !== 'panel') return
    const pending = browserPanelPendingNavigate.url
    if (pending != null && pending.length > 0) {
      browserPanelPendingNavigate.url = null
      navigateActive(pending)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 已挂载时的导航请求：导航并清掉 pending（与挂载消费互斥，避免重复导航）
  useEffect(() => {
    if (variant !== 'panel') return
    const handler = (event: Event): void => {
      const url = (event as CustomEvent<{ url?: string }>).detail?.url
      if (url == null || url.trim().length === 0) return
      browserPanelPendingNavigate.url = null
      navigateActive(url)
    }
    window.addEventListener(BROWSER_PANEL_NAVIGATE_EVENT, handler)
    return () => window.removeEventListener(BROWSER_PANEL_NAVIGATE_EVENT, handler)
  }, [variant, navigateActive])

  useEffect(() => {
    if (variant !== 'window') return
    const unsub = window.spark?.on?.(
      'stream:browser-window:navigate',
      (payload: { url: string }) => {
        if (payload?.url != null) navigateActive(payload.url)
      },
    )
    return unsub ?? (() => {})
  }, [variant, navigateActive])

  // ─── 视口 / tab 操作 ─────────────────────────────────────────────────
  const fixedViewport = useMemo(() => {
    const preset = BROWSER_VIEWPORT_PRESETS.find((item) => item.id === viewportPresetId)
    if (preset?.width == null || preset.height == null) return null
    return { width: preset.width, height: preset.height }
  }, [viewportPresetId])

  const notifyLimit = useCallback((): void => {
    toast.info(`最多同时打开 ${MAX_BROWSER_TABS} 个标签页`)
  }, [toast])

  const handleNewTab = useCallback((): void => {
    picker.stop()
    store.dispatch({ type: 'add' })
  }, [picker, store])

  const handleOpenInNewTab = useCallback(
    (url: string): void => {
      if (state.tabs.length >= MAX_BROWSER_TABS) {
        notifyLimit()
        navigateActive(url)
        return
      }
      store.dispatch({ type: 'add', url })
    },
    [state.tabs.length, notifyLimit, navigateActive, store],
  )

  // 页面 window.open / target=_blank：主进程按宿主窗口路由，转成新 tab
  const openInNewTabRef = useRef(handleOpenInNewTab)
  openInNewTabRef.current = handleOpenInNewTab
  useEffect(() => {
    const unsub = window.spark?.on?.(
      'stream:browser-panel:open-tab',
      (payload: { url: string }) => {
        if (payload?.url != null && payload.url.length > 0) openInNewTabRef.current(payload.url)
      },
    )
    return unsub ?? (() => {})
  }, [])

  const handleWebviewReady = useCallback(
    (tabId: string, webview: Electron.WebviewTag | null): void => {
      if (webview != null) webviewRefs.current.set(tabId, webview)
      else webviewRefs.current.delete(tabId)
    },
    [],
  )

  const handleMeta = useCallback(
    (
      tabId: string,
      meta: { url?: string | null; title?: string | null; favicon?: string | null },
    ): void => {
      store.dispatch({ type: 'meta', id: tabId, ...meta })
    },
    [store],
  )

  const handleNavState = useCallback((tabId: string, navState: BrowserNavState): void => {
    setNavStates((prev) =>
      prev[tabId]?.canBack === navState.canBack && prev[tabId]?.canForward === navState.canForward
        ? prev
        : { ...prev, [tabId]: navState },
    )
  }, [])

  // ─── 工具栏动作 ──────────────────────────────────────────────────────
  const withActiveWebview =
    (action: (wv: Electron.WebviewTag) => void): (() => void) =>
    () => {
      const wv = activeWebview()
      if (wv != null) action(wv)
    }

  const handleOpenExternal = withActiveWebview((wv) => {
    const url = activeTab?.url || wv.getURL()
    if (url == null || url === '' || url === BLANK_TAB_URL) {
      toast.info('当前没有可打开的页面')
      return
    }
    void window.spark.invoke('browser:open-external', { url }).catch(() => {
      toast.warning('打开默认浏览器失败')
    })
  })

  const handleOpenDevtools = useCallback((): void => {
    picker.stop()
    devtools.open()
  }, [devtools, picker])

  const handleCopyUrl = withActiveWebview((wv) => {
    const url = activeTab?.url || wv.getURL()
    if (url == null || url === '' || url === BLANK_TAB_URL) {
      toast.info('当前没有可复制的网址')
      return
    }
    void navigator.clipboard
      .writeText(url)
      .then(() => toast.success('网址已复制'))
      .catch(() => toast.warning('复制失败'))
  })

  const handleSwitchMode = useCallback((): void => {
    picker.stop()
    const url = activeTab?.url != null && activeTab.url !== BLANK_TAB_URL ? activeTab.url : null
    if (variant === 'panel') {
      void window.spark
        .invoke('browser-panel:window-open', url != null ? { url } : {})
        .then((res) => {
          if (res.success) {
            // 通知 ChatView 关闭统一面板的 browser tab（面板随即卸载）
            window.dispatchEvent(new CustomEvent(BROWSER_PANEL_CLOSE_EVENT))
          } else {
            toast.warning('打开独立窗口失败')
          }
        })
        .catch(() => toast.warning('打开独立窗口失败'))
    } else {
      void window.spark
        .invoke('browser-panel:window-restore-panel', url != null ? { url } : {})
        .catch(() => toast.warning('切换回面板失败，请手动打开浏览器面板'))
    }
  }, [picker, activeTab?.url, variant, toast])

  const activeNav = (state.activeId != null ? navStates[state.activeId] : undefined) ?? {
    canBack: false,
    canForward: false,
  }

  return (
    <div
      ref={browserRootRef}
      className={`browser-chrome browser-chrome-${variant}`}
      data-picker-active={picker.active}
    >
      <BrowserTabsBar
        tabs={state.tabs}
        activeId={state.activeId}
        maxTabs={MAX_BROWSER_TABS}
        onSelect={handleSelectTab}
        onClose={(id) => store.dispatch({ type: 'close', id })}
        onNew={handleNewTab}
        onLimitReached={notifyLimit}
      />
      <BrowserToolbar
        urlInput={urlInput}
        onUrlInputChange={setUrlInput}
        onUrlInputFocusChange={(focused) => {
          urlInputFocusedRef.current = focused
        }}
        onNavigateSubmit={() => {
          if (urlInput.trim().length === 0) return
          picker.stop()
          navigateActive(urlInput)
        }}
        onBack={withActiveWebview((wv) => {
          callWebviewSafely(wv, () => {
            if (wv.canGoBack()) wv.goBack()
          })
        })}
        onForward={withActiveWebview((wv) => {
          callWebviewSafely(wv, () => {
            if (wv.canGoForward()) wv.goForward()
          })
        })}
        onReload={withActiveWebview((wv) => {
          callWebviewSafely(wv, () => wv.reload())
        })}
        canBack={activeNav.canBack}
        canForward={activeNav.canForward}
        pickerActive={picker.active}
        onTogglePicker={picker.toggle}
        viewportPresetId={viewportPresetId}
        onViewportPresetChange={setViewportPresetId}
        variant={variant}
        onOpenExternal={handleOpenExternal}
        onOpenDevtools={handleOpenDevtools}
        onCopyUrl={handleCopyUrl}
        onSwitchMode={handleSwitchMode}
      />
      <div className="browser-chrome-viewport">
        {state.tabs.map((tab) => (
          <BrowserTabViewport
            key={tab.id}
            tab={tab}
            visible={tab.id === state.activeId}
            fixedViewport={fixedViewport}
            onWebviewReady={handleWebviewReady}
            onMeta={handleMeta}
            onNavState={handleNavState}
            onGuestReady={devtools.notifyWebviewReady}
            onDidNavigate={handleDidNavigate}
          />
        ))}
      </div>
      {devtools.isOpen && (
        <BrowserDevtoolsPanel
          height={devtools.height}
          bodyRef={devtools.bodyRef}
          onClose={devtools.close}
          onResizePointerDown={devtools.onResizePointerDown}
          onResizePointerMove={devtools.onResizePointerMove}
          onResizePointerEnd={devtools.onResizePointerEnd}
        />
      )}
    </div>
  )
}
