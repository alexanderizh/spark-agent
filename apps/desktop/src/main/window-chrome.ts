import type { BrowserWindowConstructorOptions } from 'electron'

/**
 * The native overlay is the source of truth for the renderer's
 * `env(titlebar-area-*)` values. Keep this fallback aligned with the compact
 * top-level headers used by chat and canvas views.
 */
export const WINDOW_CHROME_HEIGHT = 52
const MAC_TRAFFIC_LIGHT_DIAMETER = 14
const MAC_TRAFFIC_LIGHT_X = 22

export const MAC_TRAFFIC_LIGHT_POSITION = {
  x: MAC_TRAFFIC_LIGHT_X,
  y: Math.round((WINDOW_CHROME_HEIGHT - MAC_TRAFFIC_LIGHT_DIAMETER) / 2),
} as const

type WindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay' | 'trafficLightPosition'
>

export function buildWindowChromeOptions(platform = process.platform): WindowChromeOptions {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      titleBarOverlay: {
        height: WINDOW_CHROME_HEIGHT,
      },
      trafficLightPosition: { ...MAC_TRAFFIC_LIGHT_POSITION },
    }
  }

  return { titleBarStyle: 'hidden' }
}
