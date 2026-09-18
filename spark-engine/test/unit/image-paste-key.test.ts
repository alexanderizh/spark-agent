import { describe, expect, it } from 'vitest'

import { isImagePasteKey } from '../../src/tui/components/input-editor.js'

const noModifiers = { ctrl: false, meta: false }

describe('isImagePasteKey', () => {
  it('accepts the raw Ctrl+V byte even when the parsed ctrl flag is missing', () => {
    // 0x16 *is* Ctrl+V; a terminal or input layer that resolves the chord
    // without flagging ctrl must not turn it into draft text.
    expect(isImagePasteKey('\u0016', noModifiers, false)).toBe(true)
  })

  it('accepts a parsed ctrl+v chord', () => {
    expect(isImagePasteKey('v', { ctrl: true, meta: false }, false)).toBe(true)
  })

  it('accepts Alt+V only where the platform reserves Ctrl+V', () => {
    expect(isImagePasteKey('v', { ctrl: false, meta: true }, false)).toBe(false)
    expect(isImagePasteKey('v', { ctrl: false, meta: true }, true)).toBe(true)
  })

  it('leaves ordinary typing alone', () => {
    expect(isImagePasteKey('v', noModifiers, true)).toBe(false)
    expect(isImagePasteKey('c', { ctrl: true, meta: false }, true)).toBe(false)
  })
})
