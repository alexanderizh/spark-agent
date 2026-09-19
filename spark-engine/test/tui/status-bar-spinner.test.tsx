import React from 'react'

import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { StatusBar } from '../../src/tui/components/status-bar.js'
import { defaultTheme, type TerminalCapabilities } from '../../src/tui/theme.js'

const capabilities: TerminalCapabilities = { color: 'mono', unicode: false, width: 72 }

describe('StatusBar running indicator', () => {
  it('replaces the leading bar glyph with the animated spinner while a turn runs', () => {
    const app = render(
      <StatusBar
        model="fake-m1"
        permission="manual"
        effort="high"
        running
        tick={1}
        capabilities={capabilities}
        theme={defaultTheme}
      />,
    )
    try {
      const frame = app.lastFrame() ?? ''
      // Frame 1 of the mono spinner sequence is '+'; the idle bar '|' is gone.
      // (The status bar pads its left edge with one space.)
      expect(frame).toMatch(/^\s*\+/)
      expect(frame).not.toMatch(/^\s*\|/)
      expect(frame).toContain('fake-m1')
    } finally {
      app.unmount()
    }
  })

  it('shows the static bar glyph when idle', () => {
    const app = render(
      <StatusBar
        model="fake-m1"
        permission="manual"
        effort="high"
        capabilities={capabilities}
        theme={defaultTheme}
      />,
    )
    try {
      expect(app.lastFrame()).toMatch(/^\s*\|/)
    } finally {
      app.unmount()
    }
  })

  it('advances the spinner frame across ticks', () => {
    for (const [tick, glyph] of [
      [0, '*'],
      [1, '+'],
      [2, 'x'],
    ] as const) {
      const app = render(
        <StatusBar
          model="fake-m1"
          permission="manual"
          effort="high"
          running
          tick={tick}
          capabilities={capabilities}
          theme={defaultTheme}
        />,
      )
      try {
        expect(app.lastFrame()).toMatch(new RegExp(`^\\s*\\${glyph}`))
      } finally {
        app.unmount()
      }
    }
  })
})
