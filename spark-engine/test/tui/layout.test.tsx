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

describe('follow-the-content layout', () => {
  // Regression: the frame used to pin the chrome with a fixed height plus a
  // flexGrow spacer. The settled transcript streams through ink <Static>,
  // which occupies no frame space — the spacer turned that absent height into
  // a near-screen blank wall between the newest content and the input band,
  // pushing the content out of the viewport. The layout must stay
  // follow-the-content: blank runs above the chrome are transcript margins,
  // never a spacer.
  it('keeps the chrome directly under the content after a turn', async () => {
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

  // The live frame must not depend on the terminal height at all: height-bound
  // behavior belongs to the per-block tail budgets, so tests without a known
  // height exercise the same layout as a real terminal.
  it('renders identically with and without a known terminal height', async () => {
    const withHeight = await setupApp(30)
    for (let index = 0; index < 6; index += 1)
      await new Promise<void>((resolve) => setImmediate(resolve))
    const heightFrame = stripAnsi(withHeight.lastFrame() ?? '')
    withHeight.unmount()

    const withoutHeight = await setupApp(undefined)
    for (let index = 0; index < 6; index += 1)
      await new Promise<void>((resolve) => setImmediate(resolve))
    const noHeightFrame = stripAnsi(withoutHeight.lastFrame() ?? '')
    withoutHeight.unmount()

    expect(heightFrame).toBe(noHeightFrame)
  })
})
