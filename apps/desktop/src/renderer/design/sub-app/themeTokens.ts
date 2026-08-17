import type { ResolvedTheme } from '../AppContext'
import type { SparkAppThemeState } from '@spark/protocol'
import { THEME_PALETTE } from '../theme/LobeThemeProvider'

/**
 * 子应用主题 token bridge：把宿主 resolvedTheme + primary 解析成
 * 只读语义 token 下发给沙箱应用。
 *
 * - 色板来自 LobeThemeProvider 的单一事实来源（antd/lobe 同款）。
 * - reducedMotion 跟随宿主 prefers-reduced-motion。
 * - 字号从宿主根元素计算值读取，宿主缩放后应用无需重启即可拿到新值。
 */
export function buildThemeState(
  resolvedTheme: ResolvedTheme,
  primary: string,
  doc: Document = document,
): SparkAppThemeState {
  const palette = THEME_PALETTE[resolvedTheme]
  return {
    theme: resolvedTheme,
    tokens: {
      colorPrimary: primary,
      colorBgLayout: palette.bg,
      colorBgContainer: palette.panel,
      colorBgContainerSolid: palette.panelElev,
      colorBgElevated: palette.panelElev,
      colorBorder: palette.border,
      colorBorderStrong: palette.borderStrong,
      colorBorderSecondary: palette.divider,
      colorText: palette.text,
      colorTextStrong: palette.textStrong,
      colorTextMuted: palette.textMuted,
      colorTextFaint: palette.textFaint,
      colorBgTextHover: palette.hover,
      colorBgTextActive: palette.active,
      colorError: palette.danger,
      colorErrorBg: palette.dangerBg,
      colorSuccess: palette.success,
      colorSuccessBg: palette.successBg,
      colorWarning: palette.warning,
      colorWarningBg: palette.warningBg,
    },
    primaryColor: primary,
    fontSize: readRootFontSize(doc),
    reducedMotion: prefersReducedMotion(doc),
  }
}

function readRootFontSize(doc: Document): number {
  const raw = getComputedStyle(doc.documentElement).fontSize
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 14
}

function prefersReducedMotion(doc: Document): boolean {
  return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
