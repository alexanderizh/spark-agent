import { describe, expect, it } from 'vitest'
import {
  clampBrowserDevtoolsHeight,
  readBrowserPanelDevtoolsBounds,
} from './useBrowserPanelDevtools'

describe('browser panel DevTools layout', () => {
  it('keeps a usable page viewport while resizing the bottom panel', () => {
    expect(clampBrowserDevtoolsHeight(50, 700)).toBe(160)
    expect(clampBrowserDevtoolsHeight(900, 700)).toBe(510)
    expect(clampBrowserDevtoolsHeight(300, 250)).toBe(96)
  })

  it('rounds DOM coordinates before sending them through the integer IPC schema', () => {
    const element = {
      getBoundingClientRect: () => ({
        left: 100.4,
        top: 320.6,
        width: 499.8,
        height: 279.7,
      }),
    } as HTMLElement

    expect(readBrowserPanelDevtoolsBounds(element)).toEqual({
      x: 100,
      y: 321,
      width: 500,
      height: 280,
    })
  })
})
