import { describe, expect, it } from 'vitest'
import {
  buildWindowChromeOptions,
  MAC_TRAFFIC_LIGHT_POSITION,
  WINDOW_CHROME_HEIGHT,
} from './window-chrome.js'

describe('window chrome options', () => {
  it('exposes native macOS titlebar geometry to the renderer', () => {
    expect(buildWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      titleBarOverlay: {
        height: WINDOW_CHROME_HEIGHT,
      },
      trafficLightPosition: MAC_TRAFFIC_LIGHT_POSITION,
    })
  })

  it('centers the native traffic lights on the shared titlebar row', () => {
    expect(MAC_TRAFFIC_LIGHT_POSITION).toEqual({ x: 22, y: 19 })
  })

  it('keeps the existing hidden titlebar on Windows and Linux', () => {
    expect(buildWindowChromeOptions('win32')).toEqual({ titleBarStyle: 'hidden' })
    expect(buildWindowChromeOptions('linux')).toEqual({ titleBarStyle: 'hidden' })
  })
})
