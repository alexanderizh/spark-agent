import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { WorkingLine } from '../../src/tui/components/spinner.js'
import { defaultTheme, type TerminalCapabilities } from '../../src/tui/theme.js'

const capabilities: TerminalCapabilities = { color: 'mono', unicode: false, width: 72 }

describe('WorkingLine loading glyph', () => {
  it('prefixes the running action with the animated loading glyph', () => {
    for (const [tick, glyph] of [
      [0, '*'],
      [1, '+'],
      [2, 'x'],
    ] as const) {
      const app = render(
        <WorkingLine
          label="请求模型"
          capabilities={capabilities}
          theme={defaultTheme}
          tick={tick}
        />,
      )
      try {
        expect((app.lastFrame() ?? '').trim()).toBe(`${glyph} 请求模型`)
      } finally {
        app.unmount()
      }
    }
  })

  it('drops the separator when the runtime detail is empty', () => {
    const app = render(
      <WorkingLine
        label="请求模型"
        detail=""
        capabilities={capabilities}
        theme={defaultTheme}
        tick={0}
      />,
    )
    try {
      expect((app.lastFrame() ?? '').trim()).toBe('* 请求模型')
    } finally {
      app.unmount()
    }
  })

  it('keeps the action label and the runtime detail on one line', () => {
    const app = render(
      <WorkingLine
        label="正在思考"
        detail="+2 排队"
        capabilities={capabilities}
        theme={defaultTheme}
        tick={0}
      />,
    )
    try {
      expect((app.lastFrame() ?? '').trim()).toBe('* 正在思考 · +2 排队')
    } finally {
      app.unmount()
    }
  })
})
