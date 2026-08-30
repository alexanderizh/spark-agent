import React, { createContext, useCallback, useLayoutEffect, useState } from 'react'
import { AppDialogHost, AppProvider, useApp } from './design/AppContext'
import { AuthProvider } from './design/auth/AuthContext'
import { ToastContainer, ToastProvider } from './design/components/Toast'
import { ErrorBoundary } from './design/components/ErrorBoundary'
import { SessionSidebarProvider } from './design/SessionSidebarContext'
import { LobeThemeProvider } from './design/theme/LobeThemeProvider'
import { CanvasWorkspaceView } from './design/views/canvas/CanvasWorkspaceView'
import {
  persistCanvasWindowTheme,
  readCanvasWindowTheme,
  type CanvasWindowTheme,
} from './design/views/canvas/canvas-window-theme'
import { getCanvasWindowPlatformClass, readCanvasWindowProjectId } from './canvasWindowParams'

// Win/Linux 画布独立窗口是无边框窗口，需要在顶栏渲染自定义窗口控件；
// macOS 走原生红绿灯，无需渲染。
const rendererPlatform = typeof window !== 'undefined' ? window.spark?.platform : undefined
const showWindowControls = rendererPlatform !== 'darwin'

type CanvasWindowThemeContextValue = {
  theme: CanvasWindowTheme
  setTheme: (theme: CanvasWindowTheme) => void
}

const CanvasWindowThemeContext = createContext<CanvasWindowThemeContextValue | null>(null)

function CanvasWindowThemeBridge({ children }: { children: React.ReactNode }) {
  const { t } = useApp()
  const [theme, setTheme] = useState<CanvasWindowTheme>(() => readCanvasWindowTheme())
  const setWindowTheme = useCallback((nextTheme: CanvasWindowTheme) => {
    setTheme(nextTheme)
    persistCanvasWindowTheme(nextTheme)
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    const syncWindowTheme = () => {
      if (root.dataset.theme !== theme) root.dataset.theme = theme
      root.style.colorScheme = theme
    }

    syncWindowTheme()
    const observer = new MutationObserver(syncWindowTheme)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [theme])

  return (
    <LobeThemeProvider themeMode={theme} resolvedTheme={theme} primary={t.primary}>
      <CanvasWindowThemeContext.Provider value={{ theme, setTheme: setWindowTheme }}>
        {children}
      </CanvasWindowThemeContext.Provider>
    </LobeThemeProvider>
  )
}

function CanvasWindowShell({ projectId }: { projectId: string }) {
  const themeContext = React.useContext(CanvasWindowThemeContext)
  if (themeContext == null)
    throw new Error('CanvasWindowShell must be inside CanvasWindowThemeBridge')

  const { theme, setTheme } = themeContext

  return (
    <ErrorBoundary level="global" name="CanvasWindow">
      <div
        className={`app window canvas-window-standalone theme-${theme} density-regular ${getCanvasWindowPlatformClass()} sidebar-hidden`}
        data-canvas-window-theme={theme}
      >
        <CanvasWorkspaceView
          projectId={projectId}
          themeControlled
          windowTheme={theme}
          onWindowThemeChange={setTheme}
          showSidebarExpandButton={false}
          showWindowControls={showWindowControls}
          onBack={async () => {
            await window.spark.invoke('canvas:window:close-confirmed', {})
          }}
        />
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}

export function CanvasWindowApp() {
  const projectId = readCanvasWindowProjectId()
  if (projectId == null) {
    return (
      <div className="app window canvas-window-standalone theme-dark">
        <div className="canvas-workspace canvas-workspace-loading">Canvas project not found.</div>
      </div>
    )
  }

  return (
    <AppProvider>
      <CanvasWindowThemeBridge>
        <AuthProvider>
          <ToastProvider>
            <SessionSidebarProvider reportAppActivity={false}>
              <CanvasWindowShell projectId={projectId} />
              <AppDialogHost />
            </SessionSidebarProvider>
          </ToastProvider>
        </AuthProvider>
      </CanvasWindowThemeBridge>
    </AppProvider>
  )
}

export { readCanvasWindowProjectId }
