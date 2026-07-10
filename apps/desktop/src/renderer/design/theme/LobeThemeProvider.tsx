import React from 'react'
import { ThemeProvider } from '@lobehub/ui'
import { App as AntdApp, ConfigProvider as AntdConfigProvider } from 'antd'
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
 * Concrete palette mirrors of the CSS variables in styles.css (`.theme-light` /
 * `.theme-dark`). antd's token polisher runs color math (parseToRgb → mix) to
 * derive hover/active/shadow variants, so tokens MUST be real color strings —
 * CSS `var(...)` values crash the polisher. Picking the palette by
 * `resolvedTheme` keeps light/dark in sync with the CSS-variable layer.
 */
const PALETTE = {
  light: {
    bg: '#fdfdfc',
    panel: '#ffffff',
    panelElev: '#ffffff',
    border: '#e8e5df',
    borderStrong: '#d7d2c9',
    divider: '#efede8',
    text: '#20201d',
    textStrong: '#11100e',
    textMuted: '#6f6a61',
    textFaint: '#9b9489',
    hover: 'rgba(36, 32, 27, 0.045)',
    active: 'rgba(36, 32, 27, 0.07)',
    danger: '#ef4444',
    dangerBg: 'rgba(239, 68, 68, 0.1)',
    success: '#10b981',
    successBg: 'rgba(16, 185, 129, 0.1)',
    warning: '#f59e0b',
    warningBg: 'rgba(245, 158, 11, 0.12)',
  },
  dark: {
    bg: '#262626',
    panel: '#303030',
    panelElev: '#383838',
    border: '#3d3d3d',
    borderStrong: '#4a4a4a',
    divider: '#383838',
    text: '#e4e4e7',
    textStrong: '#fafafa',
    textMuted: '#9ca3af',
    textFaint: '#6b7280',
    hover: 'rgba(255, 255, 255, 0.04)',
    active: 'rgba(255, 255, 255, 0.07)',
    danger: '#f87171',
    dangerBg: 'rgba(248, 113, 113, 0.14)',
    success: '#22c55e',
    successBg: 'rgba(34, 197, 94, 0.14)',
    warning: '#f59e0b',
    warningBg: 'rgba(245, 158, 11, 0.16)',
  },
} as const

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
  const p = PALETTE[resolvedTheme]

  // Bridge the app's design tokens (from styles.css) into antd's global token
  // as concrete color values. Without this, antd/lobe `Button` (and other
  // default-variant components) fall back to antd's built-in dark algorithm,
  // which renders default buttons with a near-black background that clashes
  // with the app's `--panel` palette — the root cause of the
  // "black download buttons" in dark mode.
  const token = React.useMemo(
    () => ({
      colorPrimary: primary,
      colorInfo: primary,
      colorLink: primary,
      // default Button / Input / Select surface — map to app panel color
      colorBgContainer: p.panel,
      colorBgContainerSolid: p.panelElev,
      colorBgElevated: p.panelElev,
      colorBgLayout: p.bg,
      colorBgSpotlight: p.panelElev,
      // text colors
      colorText: p.text,
      colorTextSecondary: p.textMuted,
      colorTextTertiary: p.textFaint,
      colorTextHeading: p.textStrong,
      // borders
      colorBorder: p.border,
      colorBorderSecondary: p.divider,
      // hover / active for text-style controls (text Button, ActionIcon hover)
      colorBgTextHover: p.hover,
      colorBgTextActive: p.active,
      // danger / success / warning aligned with app palette
      colorError: p.danger,
      colorErrorBg: p.dangerBg,
      colorSuccess: p.success,
      colorSuccessBg: p.successBg,
      colorWarning: p.warning,
      colorWarningBg: p.warningBg,
    }),
    [p, primary],
  )

  React.useEffect(() => {
    // Static message/notification APIs render outside the component tree.
    // Give them the same App context so antd does not fall back to its
    // context-less static holder (and emit the dynamic-theme warning).
    AntdConfigProvider.config({
      holderRender: (holder: React.ReactNode) => (
        <AntdConfigProvider theme={{ token }}>
          <AntdApp component={false}>{holder}</AntdApp>
        </AntdConfigProvider>
      ),
    })
  }, [token])

  React.useEffect(() => {
    // Static message/notification APIs render outside the component tree.
    // Give them the same App context so antd does not fall back to its
    // context-less static holder (and emit the dynamic-theme warning).
    AntdConfigProvider.config({
      holderRender: (holder: React.ReactNode) => (
        <AntdConfigProvider theme={{ token }}>
          <AntdApp component={false}>{holder}</AntdApp>
        </AntdConfigProvider>
      ),
    })
  }, [token])

  return (
    <ThemeProvider
      appearance={appearance}
      themeMode={themeMode === 'system' ? 'auto' : themeMode}
      enableCustomFonts={false}
      theme={{
        token,
        components: {
          // Pin the default Button surface to the app panel so the default
          // variant never drifts to antd's computed dark background.
          Button: {
            colorBgContainer: p.panel,
            defaultBorderColor: p.border,
            defaultColor: p.text,
            defaultHoverBg: p.hover,
            defaultHoverColor: p.text,
            defaultHoverBorderColor: p.borderStrong,
            defaultActiveBg: p.active,
            defaultActiveColor: p.text,
            defaultActiveBorderColor: p.borderStrong,
            textHoverBg: p.hover,
            // primary follows colorPrimary (already set globally)
            primaryColor: '#ffffff',
            primaryShadow: 'transparent',
            defaultShadow: 'transparent',
            fontWeight: 500,
          },
        },
      }}
    >
      {children}
    </ThemeProvider>
  )
}
