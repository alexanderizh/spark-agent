import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * The native overlay is the source of truth for the renderer's
 * `env(titlebar-area-*)` values. Keep this fallback aligned with the compact
 * top-level headers used by chat and canvas views.
 */
export const WINDOW_CHROME_HEIGHT = 52

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay'
>

export function buildWindowChromeOptions(platform = process.platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      titleBarOverlay: {
        height: WINDOW_CHROME_HEIGHT,
      },
    }
  }

  return { titleBarStyle: 'hidden' }
}
