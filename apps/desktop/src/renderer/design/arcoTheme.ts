/**
 * @deprecated Arco Design 已全量下线,这些函数保留为 no-op 以避免破坏现有调用方
 * (AppContext.applyArcoTheme / useAppearance.syncArcoThemeFromDom)。
 *
 * 主题由 LobeThemeProvider (antd + lobe-ui) 接管。
 */
import type { ResolvedTheme } from './AppContext'

export function applyArcoTheme(_resolvedTheme: ResolvedTheme, _primaryHex: string): void {
  // no-op
}

export function syncArcoThemeFromDom(): void {
  // no-op
}
