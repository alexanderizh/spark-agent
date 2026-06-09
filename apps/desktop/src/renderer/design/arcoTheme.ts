/**
 * Sync Arco Design CSS design tokens with the Spark app theme.
 *
 * Arco reads palette variables (`--primary-N`, `--arcoblue-N`) as RGB triplets on
 * `body`, e.g. `rgb(var(--primary-6))`. Semantic tokens (`--color-bg-1`, etc.)
 * also live on `body` / `body[arco-theme=dark]`.
 *
 * @see https://arco.design/react/docs/token
 */
import { generate, getRgbStr } from '@arco-design/color'
import type { ResolvedTheme } from './AppContext'

const DEFAULT_PRIMARY = '#6366f1'

function readAppToken(name: string, fallback = ''): string {
  const html = document.documentElement
  const inline = html.style.getPropertyValue(name).trim()
  if (inline) return inline
  return getComputedStyle(html).getPropertyValue(name).trim() || fallback
}

/** Apply Arco palette + semantic tokens for the resolved light/dark theme. */
export function applyArcoTheme(resolvedTheme: ResolvedTheme, primaryHex: string): void {
  const body = document.body
  const isDark = resolvedTheme === 'dark'

  if (isDark) {
    body.setAttribute('arco-theme', 'dark')
  } else {
    body.removeAttribute('arco-theme')
  }

  const palette = generate(primaryHex, { list: true, dark: isDark }) as string[]
  for (let i = 0; i < 10; i++) {
    const rgb = getRgbStr(palette[i]!)
    const step = String(i + 1)
    body.style.setProperty(`--arcoblue-${step}`, rgb)
    body.style.setProperty(`--primary-${step}`, rgb)
    body.style.setProperty(`--link-${step}`, rgb)
  }

  const semanticMap: Record<string, string> = {
    '--color-bg-1': readAppToken('--bg'),
    '--color-bg-2': readAppToken('--panel'),
    '--color-bg-3': readAppToken('--panel-elev'),
    '--color-bg-popup': readAppToken('--panel-elev'),
    '--color-bg-5': readAppToken('--panel-elev'),
    '--color-text-1': readAppToken('--text-strong'),
    '--color-text-2': readAppToken('--text'),
    '--color-text-3': readAppToken('--text-muted'),
    '--color-text-4': readAppToken('--text-faint'),
    '--color-border': readAppToken('--border'),
    '--color-border-2': readAppToken('--border'),
    '--color-border-3': readAppToken('--border-strong'),
    '--color-fill-1': readAppToken('--bg-soft'),
    '--color-fill-2': readAppToken('--hover'),
    '--color-fill-3': readAppToken('--active'),
    '--border-radius-small': readAppToken('--r-sm'),
    '--border-radius-medium': readAppToken('--r-md'),
    '--border-radius-large': readAppToken('--r-lg'),
  }

  for (const [token, value] of Object.entries(semanticMap)) {
    if (value) body.style.setProperty(token, value)
  }

  const fontSans = readAppToken('--font-sans')
  if (fontSans) body.style.fontFamily = fontSans

  const fontBase = readAppToken('--font-base')
  if (fontBase) body.style.fontSize = fontBase
}

/** Re-sync Arco tokens from current `html` theme + primary (e.g. after appearance settings). */
export function syncArcoThemeFromDom(): void {
  const html = document.documentElement
  const resolved: ResolvedTheme = html.dataset.theme === 'dark' ? 'dark' : 'light'
  const primary = readAppToken('--primary', DEFAULT_PRIMARY)
  applyArcoTheme(resolved, primary)
}
