import React from 'react'
import { AppDialogHost, AppProvider, useApp } from './design/AppContext'
import { AuthProvider } from './design/auth/AuthContext'
import { ToastContainer, ToastProvider } from './design/components/Toast'
import { ErrorBoundary } from './design/components/ErrorBoundary'
import { SessionSidebarProvider } from './design/SessionSidebarContext'
import { LobeThemeProvider } from './design/theme/LobeThemeProvider'
import { useResolvedTheme } from './design/hooks/useResolvedTheme'
import { CanvasWorkspaceView } from './design/views/canvas/CanvasWorkspaceView'
import { getCanvasWindowPlatformClass, readCanvasWindowProjectId } from './canvasWindowParams'

function CanvasWindowThemeBridge({ children }: { children: React.ReactNode }) {
  const { t } = useApp()
  const resolvedTheme = useResolvedTheme()
  return (
    <LobeThemeProvider themeMode={t.theme} resolvedTheme={resolvedTheme} primary={t.primary}>
      {children}
    </LobeThemeProvider>
  )
}

function CanvasWindowShell({ projectId }: { projectId: string }) {
  return (
    <ErrorBoundary level="global" name="CanvasWindow">
      <div
        className={`app window canvas-window-standalone theme-dark density-regular ${getCanvasWindowPlatformClass()} sidebar-hidden`}
      >
        <CanvasWorkspaceView
          projectId={projectId}
          showSidebarExpandButton={false}
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
            <SessionSidebarProvider>
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
