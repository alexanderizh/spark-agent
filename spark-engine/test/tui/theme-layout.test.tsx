import { describe, expect, it } from 'vitest'

import { pickerRowStyle } from '../../src/tui/components/picker-layout.js'
import { defaultTheme, supportsRichBackground } from '../../src/tui/theme.js'

describe('TUI theme capability fallbacks', () => {
  it('uses solid fills only when the terminal can preserve their contrast', () => {
    expect(supportsRichBackground({ color: 'truecolor', unicode: true, width: 80 })).toBe(true)
    expect(supportsRichBackground({ color: '256', unicode: true, width: 80 })).toBe(true)
    expect(supportsRichBackground({ color: '16', unicode: true, width: 80 })).toBe(false)
    expect(supportsRichBackground({ color: 'mono', unicode: false, width: 80 })).toBe(false)
  })

  it('falls back from a rich background to inverse video for a selected row', () => {
    const rich = pickerRowStyle(
      true,
      defaultTheme,
      { color: 'truecolor', unicode: true, width: 80 },
    )
    const limited = pickerRowStyle(
      true,
      defaultTheme,
      { color: '16', unicode: true, width: 80 },
    )
    const legacyTheme = pickerRowStyle(
      true,
      {
        dim: defaultTheme.dim,
        accent: defaultTheme.accent,
        ok: defaultTheme.ok,
        warn: defaultTheme.warn,
        error: defaultTheme.error,
      },
      { color: 'truecolor', unicode: true, width: 80 },
    )

    expect(rich).toEqual({ backgroundColor: defaultTheme.selectedBg, inverse: false })
    expect(limited).toEqual({ backgroundColor: undefined, inverse: true })
    expect(legacyTheme).toEqual({ backgroundColor: undefined, inverse: true })
  })
})
