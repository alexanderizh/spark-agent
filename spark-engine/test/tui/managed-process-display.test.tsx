import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { presentTool, presentToolResult } from '../../src/tui/tool-presentation.js'
import { Transcript } from '../../src/tui/components/rows.js'
import { defaultTheme } from '../../src/tui/theme.js'

const id = 'abcdef01-2345-6789-abcd-123456789abc'
describe('managed process terminal display', () => {
  it('shows a running command without a completion checkmark', () => {
    const result = presentToolResult(
      'bash',
      JSON.stringify({
        process_id: id,
        status: 'running',
        output: 'partial\u001b[2J',
        next_cursor: 7,
        has_more: false,
      }),
      30,
      64,
    )
    const app = render(
      <Transcript
        staticOutput={false}
        theme={defaultTheme}
        capabilities={{ color: 'mono', unicode: false, width: 64 }}
        rows={[
          {
            key: 'start',
            text: '',
            tone: 'dim',
            toolLine: {
              tool: 'bash',
              title: 'Bash · build',
              ok: true,
              durationMs: result.duration,
              resultLines: result.lines,
              isTask: false,
              ...(result.processStatus === undefined
                ? {}
                : { processStatus: result.processStatus }),
              ...(result.processId === undefined ? {} : { processId: result.processId }),
            },
          },
        ]}
      />,
    )
    try {
      const frame = app.lastFrame() ?? ''
      expect(frame).toContain('still running')
      expect(frame).toContain('process abcdef01-234')
      expect(frame).not.toContain('completed')
      expect(frame).toContain('␛[2J')
    } finally {
      app.unmount()
    }
  })
  it('labels wait/cancel and handles terminal failures without showing raw JSON', () => {
    expect(presentTool('process_wait', { process_id: id }).title).toContain('Wait')
    expect(presentTool('process_cancel', { process_id: id }).title).toContain('Cancel')
    const result = presentToolResult(
      'process_wait',
      JSON.stringify({
        process_id: id,
        status: 'timed_out',
        output: '',
        next_cursor: 0,
        error: 'deadline',
      }),
      10,
      64,
    )
    expect(result.processStatus).toBe('timed out')
    expect(result.lines).toContain('deadline')
    expect(presentToolResult('bash', 'ordinary output', 10, 64).processStatus).toBeUndefined()
  })
})
