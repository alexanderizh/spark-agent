/**
 * BrowserWindowApp — 内置浏览器「独立窗口」模式的 React 根。
 *
 * 主进程 BrowserPanelWindowService 以 `?window=browser&url=…` 加载渲染端，
 * main.tsx 据此路由到这里。与会话右侧统一面板的 browser tab 共用 BrowserChrome，
 * 但持有自己的 tab store（跨窗口 JS 上下文不共享），初始 URL 来自参数。
 */
import React from 'react'
import { AppProvider } from './design/AppContext'
import { ToastContainer, ToastProvider } from './design/components/Toast'
import { ErrorBoundary } from './design/components/ErrorBoundary'
import { BrowserChrome } from './design/components/browser/BrowserChrome'
import { BrowserTabsStore } from './design/components/browser/browserTabsStore'
import { DEFAULT_BROWSER_URL } from './design/components/browser/browserChromeShared'
import {
  isBrowserWindowMode,
  readBrowserWindowInitialUrl,
} from './browserWindowParams'

const windowStore = new BrowserTabsStore(readBrowserWindowInitialUrl() ?? DEFAULT_BROWSER_URL)

function BrowserWindowShell(): React.ReactElement {
  return (
    <div className="app window browser-window-standalone">
      <BrowserChrome variant="window" store={windowStore} />
      <ToastContainer />
    </div>
  )
}

export function BrowserWindowApp(): React.ReactElement {
  if (!isBrowserWindowMode()) {
    return (
      <div className="app window browser-window-standalone">
        <div className="browser-window-invalid">浏览器窗口参数缺失。</div>
      </div>
    )
  }
  return (
    <ErrorBoundary level="global" name="BrowserWindow">
      <AppProvider>
        <ToastProvider>
          <BrowserWindowShell />
        </ToastProvider>
      </AppProvider>
    </ErrorBoundary>
  )
}
