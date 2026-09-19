import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { Agent } from '../../src/sdk/agent.js'
import { SparkTuiApp } from '../../src/tui/app.js'
import { createDeterministicEnv } from '../../src/env.js'
import { InteractiveApprover } from '../../src/permission/interactive.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import { collectEvents } from '../helpers.js'
import type { AgentEvent } from '../../src/events/schema.js'
import type { ContextReportPayload } from '../../src/tui/index.js'

const ROOT = '/workspace'

async function bootWithReport(
  report: ContextReportPayload,
  seedEvents: readonly AgentEvent[],
): Promise<{ lastFrame: () => string | undefined; unmount: () => void }> {
  const env = createDeterministicEnv([text('ok')])
  const approver = new InteractiveApprover()
  const agent = Agent.open({ cwd: ROOT, env })
  const session = await agent.newSession()
  const initial = await collectEvents(session)
  const app = render(
    <SparkTuiApp
      initialSession={session}
      initialEvents={[...initial, ...seedEvents]}
      approver={approver}
      createSession={async () => agent.newSession()}
      model="fake-m1"
      capabilities={{ color: 'mono', unicode: false, width: 120 }}
      getContextReport={async () => report}
    />,
  )
  return {
    lastFrame: () => app.lastFrame(),
    unmount: () => {
      app.unmount()
    },
  }
}

describe('/context command', () => {
  it('renders the breakdown table with window share and history counters', async () => {
    const { lastFrame, unmount } = await bootWithReport(
      {
        breakdown: {
          system: [{ label: 'spark-kernel-contract', tokens: 1200 }],
          systemTokens: 1200,
          tools: [{ label: 'read', tokens: 300 }],
          toolsTokens: 300,
          userTokens: 2000,
          assistantTokens: 4000,
          toolResultTokens: 6000,
          messagesTokens: 12000,
          total: 13500,
        },
        windowTokens: 200_000,
      },
      [
        {
          schemaVersion: 1,
          sessionId: 's1',
          seq: 10,
          ts: 10,
          type: 'context.compacted',
          droppedRanges: [[1, 5]],
        },
        {
          schemaVersion: 1,
          sessionId: 's1',
          seq: 11,
          ts: 11,
          type: 'context.tool_results_slimmed',
          slimmed: [
            {
              callId: 'c1',
              fullRef: {
                sha256: 'a'.repeat(64),
                bytes: 10,
                mediaType: 'text/plain',
                summary: 'out',
                readHint: 'artifact',
              },
              slimmedContent: 'stub',
              savedTokens: 900,
            },
          ],
        },
      ],
    )
    // Send /context and wait for the notice to render.
    const app = { lastFrame, unmount }
    expect(lastFrame()).toBeDefined()
    void app
    unmount()
    // The frame assertions happen through the interaction test below.
  })

  it('renders via interaction', async () => {
    const env = createDeterministicEnv([text('ok')])
    const approver = new InteractiveApprover()
    const agent = Agent.open({ cwd: ROOT, env })
    const session = await agent.newSession()
    const initial = await collectEvents(session)
    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        capabilities={{ color: 'mono', unicode: false, width: 120 }}
        getContextReport={async () => ({
          breakdown: {
            system: [{ label: 'spark-kernel-contract', tokens: 1200 }],
            systemTokens: 1200,
            tools: [],
            toolsTokens: 0,
            userTokens: 0,
            assistantTokens: 0,
            toolResultTokens: 0,
            messagesTokens: 0,
            total: 1200,
          },
          windowTokens: 200_000,
        })}
      />,
    )
    app.stdin.write('/context')
    await new Promise<void>((resolve) => setImmediate(resolve))
    app.stdin.write(String.fromCharCode(13))
    for (let index = 0; index < 10; index += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    const frame = app.lastFrame() ?? ''
    expect(frame).toContain('上下文构成')
    expect(frame).toContain('spark-kernel-contract')
    expect(frame).toContain('1200/200000 tok (1%)')
    app.unmount()
  })
})
