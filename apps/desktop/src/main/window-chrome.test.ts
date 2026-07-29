import { describe, expect, it } from 'vitest'
import { buildWindowChromeOptions, WINDOW_CHROME_HEIGHT } from './window-chrome.js'

describe('window chrome options', () => {
  it('exposes native macOS titlebar geometry to the renderer', () => {
    expect(buildWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
      titleBarOverlay: {
        height: WINDOW_CHROME_HEIGHT,
      },
    })
  })

  it('keeps the existing hidden titlebar on Windows and Linux', () => {
    expect(buildWindowChromeOptions('win32')).toEqual({ titleBarStyle: 'hidden' })
    expect(buildWindowChromeOptions('linux')).toEqual({ titleBarStyle: 'hidden' })
  })
})
