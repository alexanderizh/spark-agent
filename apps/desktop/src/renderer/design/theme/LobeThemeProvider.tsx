import React from 'react'
import { ThemeProvider } from '@lobehub/ui'
import type { ThemeAppearance } from 'antd-style'
import '@lobehub/webfont-geist/css/index.css'
import '@lobehub/webfont-geist-mono/css/index.css'
import '@lobehub/webfont-harmony-sans-sc/css/index.css'
import 'katex/dist/katex.min.css'
import type { ResolvedTheme, ThemeMode } from '../AppContext'

type LobeThemeProviderProps = {
  themeMode: ThemeMode
  resolvedTheme: ResolvedTheme
  primary: string
  children: React.ReactNode
}

/**
 * Wraps @lobehub/ui ThemeProvider so lobe-ui + antd v6 components read the
 * same `theme` / `primary` source as the rest of the app.
 *
 * Kept separate from Arco's CSS-variable-based theming. During the migration
 * period both can coexist without conflict because Arco here never used a
 * React ConfigProvider — it reads CSS variables off <body>.
 */
export function LobeThemeProvider({
  themeMode,
  resolvedTheme,
  primary,
  children,
}: LobeThemeProviderProps) {
  const appearance: ThemeAppearance = resolvedTheme === 'dark' ? 'dark' : 'light'

  return (
    <ThemeProvider
      appearance={appearance}
      themeMode={themeMode === 'system' ? 'auto' : themeMode}
      enableCustomFonts={false}
      theme={{
        token: {
          colorPrimary: primary,
          colorInfo: primary,
          colorLink: primary,
        },
      }}
    >
      {children}
    </ThemeProvider>
  )
}
