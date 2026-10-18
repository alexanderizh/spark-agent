import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { ActiveTools } from '../../src/tui/components/rows.js'
import type { ActiveToolProjection } from '../../src/tui/projection.js'
import { defaultTheme, detectTerminalCapabilities } from '../../src/tui/theme.js'

function tool(callId: string, title: string): ActiveToolProjection {
  return { callId, tool: title.toLowerCase(), title, status: 'running', isTask: false }
}

describe('ActiveTools live cap', () => {
  it('keeps the newest tools and folds older ones into a hint line', () => {
    const app = render(
      <ActiveTools
        tools={[tool('t1', 'Read a'), tool('t2', 'Write b'), tool('t3', 'Bash c'), tool('t4', 'Grep d'), tool('t5', 'Edit e')]}
        maxVisible={3}
        capabilities={detectTerminalCapabilities()}
        theme={defaultTheme}
      />,
    )
    try {
      const frame = app.lastFrame() ?? ''
      // The three newest tools stay; the two oldest collapse into one hint.
      expect(frame).toContain('还有 2 个工具在后台运行')
      expect(frame).toContain('Grep d')
      expect(frame).toContain('Edit e')
      expect(frame).not.toContain('Read a')
      expect(frame).not.toContain('Write b')
    } finally {
      app.unmount()
    }
  })

  it('renders every tool unchanged when the list fits the cap', () => {
    const app = render(
      <ActiveTools
        tools={[tool('t1', 'Read a'), tool('t2', 'Write b')]}
        maxVisible={3}
        capabilities={detectTerminalCapabilities()}
        theme={defaultTheme}
      />,
    )
    try {
      const frame = app.lastFrame() ?? ''
      expect(frame).not.toContain('在后台运行')
      expect(frame).toContain('Read a')
      expect(frame).toContain('Write b')
    } finally {
      app.unmount()
    }
  })

  it('shows no hint and no container margin for an empty tool list', () => {
    const app = render(
      <ActiveTools
        tools={[]}
        maxVisible={3}
        capabilities={detectTerminalCapabilities()}
        theme={defaultTheme}
      />,
    )
    try {
      expect(app.lastFrame()).toBe('')
    } finally {
      app.unmount()
    }
  })
})
