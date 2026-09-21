import { describe, expect, it } from 'vitest'

import {
  getQuickCreateWindowPlatformClass,
  isQuickCreateWindowMode,
} from './quickCreateWindowParams'

describe('quick create window params', () => {
  it('recognizes only the quick-create standalone window', () => {
    expect(isQuickCreateWindowMode('?window=quick-create')).toBe(true)
    expect(isQuickCreateWindowMode('?window=canvas')).toBe(false)
    expect(isQuickCreateWindowMode('?window=quick-create&projectId=1')).toBe(true)
  })

  it('maps standalone window platforms to app classes', () => {
    expect(getQuickCreateWindowPlatformClass('darwin')).toBe('platform-darwin')
    expect(getQuickCreateWindowPlatformClass('win32')).toBe('platform-win32')
    expect(getQuickCreateWindowPlatformClass('linux')).toBe('platform-linux')
  })
})
