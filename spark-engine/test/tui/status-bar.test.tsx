import React from 'react'

import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { StatusBar } from '../../src/tui/components/status-bar.js'
import { defaultTheme, type TerminalCapabilities } from '../../src/tui/theme.js'

const capabilities: TerminalCapabilities = { color: 'mono', unicode: false, width: 72 }

describe('StatusBar chrome line', () => {
  it('renders the model row without any leading glyph', () => {
    // The status bar is deliberately static: running state lives in the
    // WorkingLine above the input, never as a second spinner here.
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
      const frame = app.lastFrame() ?? ''
      // Blank alignment cells only: the row must never carry a bar glyph or a
      // spinner frame (mono or unicode star-flower).
      expect(frame).toMatch(/^\s*fake-m1/)
      expect(frame).not.toMatch(/^\s*[|▎*+x✢✳✶✻✽]/)
    } finally {
      app.unmount()
    }
  })

  it('keeps the model and mode segments on one quiet line', () => {
    const app = render(
      <StatusBar
        model="fake-m1"
        permission="auto"
        effort="high"
        cwd="~/demo"
        capabilities={capabilities}
        theme={defaultTheme}
      />,
    )
    try {
      const frame = app.lastFrame() ?? ''
      expect(frame).toContain('fake-m1')
      expect(frame).toContain('auto')
      expect(frame).toContain('high')
      expect(frame).toContain('~/demo')
    } finally {
      app.unmount()
    }
  })
})
