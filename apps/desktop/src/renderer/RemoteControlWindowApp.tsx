import React from 'react'
import { AppDialogHost, AppProvider, useApp } from './design/AppContext'
import { AuthProvider } from './design/auth/AuthContext'
import { ToastContainer, ToastProvider } from './design/components/Toast'
import { ErrorBoundary } from './design/components/ErrorBoundary'
import { SessionSidebarProvider } from './design/SessionSidebarContext'
import { LobeThemeProvider } from './design/theme/LobeThemeProvider'
import { useResolvedTheme } from './design/hooks/useResolvedTheme'
import { RemoteControlView } from './design/views/remote-control/RemoteControlView'
import { getRemoteControlWindowPlatformClass } from './remoteControlWindowParams'

function RemoteControlWindowThemeBridge({ children }: { children: React.ReactNode }) {
  const { t } = useApp()
  const resolvedTheme = useResolvedTheme()

  return (
    <LobeThemeProvider themeMode={t.theme} resolvedTheme={resolvedTheme} primary={t.primary}>
      {children}
    </LobeThemeProvider>
  )
}

function RemoteControlWindowShell() {
  const { t } = useApp()
  const resolvedTheme = useResolvedTheme()

  return (
    <ErrorBoundary level="global" name="RemoteControlWindow">
      <div
        className={`app window remote-control-window-standalone theme-${resolvedTheme} density-${t.density} ${getRemoteControlWindowPlatformClass()} sidebar-hidden`}
      >
        <RemoteControlView />
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}

export function RemoteControlWindowApp() {
  return (
    <AppProvider>
      <RemoteControlWindowThemeBridge>
        <AuthProvider>
          <ToastProvider>
            <SessionSidebarProvider reportAppActivity={false}>
              <RemoteControlWindowShell />
              <AppDialogHost />
            </SessionSidebarProvider>
          </ToastProvider>
        </AuthProvider>
      </RemoteControlWindowThemeBridge>
    </AppProvider>
  )
}
