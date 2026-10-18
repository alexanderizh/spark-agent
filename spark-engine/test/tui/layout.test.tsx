import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { InteractiveApprover } from '../../src/permission/interactive.js'
import { RulePermissionPolicy } from '../../src/permission/policy.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import { SparkTuiApp } from '../../src/tui/app.js'

const stripAnsi = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replaceAll(/\u001B\[[0-9;?]*[a-zA-Z]/g, '').replaceAll(/\u001B\][^\u0007]*\u0007/g, '')

const MAX_BLANK_RUN = 2

function maxBlankRun(frame: string): number {
  let run = 0
  let worst = 0
  for (const line of frame.split('\n')) {
    if (line.trim() === '') {
      run += 1
      worst = Math.max(worst, run)
    } else {
      run = 0
    }
  }
  return worst
}

async function setupApp(height: number | undefined) {
  const base = createDeterministicEnv([text('First answer body.')])
  const approver = new InteractiveApprover()
  const env = { ...base, permission: { policy: new RulePermissionPolicy(), approver } }
  const agent = Agent.open({ cwd: '/workspace', env })
  const session = await agent.newSession()
  return render(
    <SparkTuiApp
      initialSession={session}
      initialEvents={[]}
      approver={approver}
      createSession={async () => agent.newSession()}
      model="fake-m1"
      capabilities={{
        color: 'mono',
        unicode: false,
        width: 80,
        ...(height === undefined ? {} : { height }),
      }}
    />,
  )
}

describe('pinned-bottom layout', () => {
  // Without a known height (pipes, tests) the frame and spacer collapse: the
  // layout stays follow-the-content and the chrome hugs the newest content.
  it('keeps the chrome directly under the content without a known height', async () => {
    const app = await setupApp(undefined)
    app.stdin.write('hi there')
    await new Promise<void>((resolve) => setImmediate(resolve))
    app.stdin.write('\r')
    for (let index = 0; index < 30; index += 1)
      await new Promise<void>((resolve) => setImmediate(resolve))

    const frame = stripAnsi(app.lastFrame() ?? '')
    expect(maxBlankRun(frame)).toBeLessThanOrEqual(MAX_BLANK_RUN)
    expect(frame).toContain('fake-m1')
    app.unmount()
  })

  // Codex-style app surface: with a known height the chrome docks to the
  // window's bottom edge even when content is sparse, the frame never
  // outgrows the terminal (a full-height frame scrolls every repaint and
  // desyncs Ink's erase accounting), and the latest exchange stays visible
  // above the input band instead of vanishing into the scrollback.
  it('docks the chrome at the bottom edge with a known height', async () => {
    const app = await setupApp(30)
    for (let index = 0; index < 6; index += 1)
      await new Promise<void>((resolve) => setImmediate(resolve))
    const emptyFrame = stripAnsi(app.lastFrame() ?? '')
    const emptyRows = emptyFrame.split('\n')
    expect(emptyRows.length).toBeLessThanOrEqual(29)
    expect(emptyRows.at(-1)).toContain('fake-m1')
    // Sparse state: welcome content anchors at the top, blank absorbs the rest.
    expect(emptyFrame).toContain('Spark')
    expect(maxBlankRun(emptyFrame)).toBeGreaterThan(MAX_BLANK_RUN)

    app.stdin.write('hi there')
    await new Promise<void>((resolve) => setImmediate(resolve))
    app.stdin.write('\r')
    for (let index = 0; index < 30; index += 1)
      await new Promise<void>((resolve) => setImmediate(resolve))

    const frame = stripAnsi(app.lastFrame() ?? '')
    const rows = frame.split('\n')
    // ink-testing-library concatenates the <Static> scrollback copy in front
    // of the live frame; a real terminal scrolls it above the viewport. The
    // live frame starts at the pane tail's copy of the user message, so slice
    // there and assert the live frame alone fits height-1 rows.
    let tailAnchor = 0
    rows.forEach((line, index) => {
      if (line.includes('hi there')) tailAnchor = index
    })
    expect(rows.length - tailAnchor).toBeLessThanOrEqual(29)
    expect(rows.at(-1)).toContain('fake-m1')
    expect(rows.at(-3)).toContain('Spark')
    expect(frame).toContain('hi there')
    expect(frame).toContain('First answer body.')
    app.unmount()
  })
})