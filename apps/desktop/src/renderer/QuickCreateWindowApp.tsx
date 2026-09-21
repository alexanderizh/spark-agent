import React from 'react'
import { AppDialogHost, AppProvider, useApp } from './design/AppContext'
import { AuthProvider } from './design/auth/AuthContext'
import { ToastContainer, ToastProvider } from './design/components/Toast'
import { ErrorBoundary } from './design/components/ErrorBoundary'
import { SessionSidebarProvider } from './design/SessionSidebarContext'
import { LobeThemeProvider } from './design/theme/LobeThemeProvider'
import { useResolvedTheme } from './design/hooks/useResolvedTheme'
import { QuickCreateView } from './design/views/canvas/QuickCreateView'
import { getQuickCreateWindowPlatformClass } from './quickCreateWindowParams'

function QuickCreateWindowThemeBridge({ children }: { children: React.ReactNode }) {
  const { t } = useApp()
  const resolvedTheme = useResolvedTheme()

  return (
    <LobeThemeProvider themeMode={t.theme} resolvedTheme={resolvedTheme} primary={t.primary}>
      {children}
    </LobeThemeProvider>
  )
}

function QuickCreateWindowShell() {
  const { t } = useApp()
  const resolvedTheme = useResolvedTheme()

  return (
    <ErrorBoundary level="global" name="QuickCreateWindow">
      <div
        className={`app window quick-create-window-standalone theme-${resolvedTheme} density-${t.density} ${getQuickCreateWindowPlatformClass()} sidebar-hidden`}
      >
        <QuickCreateView />
        <ToastContainer />
      </div>
    </ErrorBoundary>
  )
}

export function QuickCreateWindowApp() {
  return (
    <AppProvider>
      <QuickCreateWindowThemeBridge>
        <AuthProvider>
          <ToastProvider>
            <SessionSidebarProvider reportAppActivity={false}>
              <QuickCreateWindowShell />
              <AppDialogHost />
            </SessionSidebarProvider>
          </ToastProvider>
        </AuthProvider>
      </QuickCreateWindowThemeBridge>
    </AppProvider>
  )
}
