import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../src/events/schema.js'
import { createDeterministicEnv } from '../../src/env.js'
import { InteractiveApprover } from '../../src/permission/interactive.js'
import { RulePermissionPolicy } from '../../src/permission/policy.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import { SparkTuiApp } from '../../src/tui/app.js'
import { ScrollRegion, parseMouseWheelDelta } from '../../src/tui/components/scroll-region.js'

describe('TUI output scrolling', () => {
  it('decodes SGR wheel reports without treating clicks as scrolls', () => {
    expect(parseMouseWheelDelta('\u001b[<64;20;8M')).toBe(-1)
    expect(parseMouseWheelDelta('\u001b[<65;20;8M')).toBe(1)
    expect(parseMouseWheelDelta('\u001b[<0;20;8M')).toBeUndefined()
  })

  it('keeps the output viewport at the requested position until End', async () => {
    const app = render(
      <ScrollRegion height={3}>
        <Box flexDirection="column">
          {Array.from({ length: 8 }, (_, index) => (
            <Text key={index}>line {index + 1}</Text>
          ))}
        </Box>
      </ScrollRegion>,
    )
    await settle()

    let frame = stripAnsi(app.lastFrame() ?? '')
    expect(frame).toContain('line 8')
    expect(frame).not.toContain('line 1')

    app.stdin.write('\u001b[<64;20;8M')
    await settle()
    frame = stripAnsi(app.lastFrame() ?? '')
    expect(frame).toMatch(/(?:^|\n)line 3(?:\n|$)/)
    expect(frame).not.toMatch(/(?:^|\n)line 1(?:\n|$)/)

    app.stdin.write('\u001b[H')
    await settle()
    frame = stripAnsi(app.lastFrame() ?? '')
    expect(frame).toContain('line 1')
    expect(frame).not.toContain('line 8')

    app.rerender(
      <ScrollRegion height={3}>
        <Box flexDirection="column">
          {Array.from({ length: 10 }, (_, index) => (
            <Text key={index}>line {index + 1}</Text>
          ))}
        </Box>
      </ScrollRegion>,
    )
    await settle()
    frame = stripAnsi(app.lastFrame() ?? '')
    expect(frame).toContain('line 1')
    expect(frame).not.toMatch(/(?:^|\n)line 10(?:\n|$)/)

    app.stdin.write('\u001b[F')
    await settle()
    frame = stripAnsi(app.lastFrame() ?? '')
    expect(frame).toContain('line 10')
    expect(frame).not.toMatch(/(?:^|\n)line 1(?:\n|$)/)
    app.unmount()
  })

  it('uses the same scroll behavior in the Spark TUI transcript', async () => {
    const base = createDeterministicEnv([
      text(Array.from({ length: 14 }, (_, index) => `reply line ${index + 1}`).join('\n')),
    ])
    const approver = new InteractiveApprover()
    const env = {
      ...base,
      permission: { policy: new RulePermissionPolicy(), approver },
    }
    const agent = Agent.open({ cwd: '/workspace', env })
    const session = await agent.newSession()
    await session.turn('show a long reply')
    const initial = await collect(session)
    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        capabilities={{ color: 'mono', unicode: false, width: 80, height: 10 }}
      />,
    )
    await settle()

    let frame = stripAnsi(app.lastFrame() ?? '')
    expect(frame).toContain('reply line 14')
    expect(frame).not.toMatch(/(?:^|\n)reply line 1(?:\n|$)/)

    app.stdin.write('\u001b[H')
    await settle()
    frame = stripAnsi(app.lastFrame() ?? '')
    expect(frame).toContain('reply line 1')
    expect(frame).not.toMatch(/(?:^|\n)reply line 14(?:\n|$)/)

    app.unmount()
  })
})

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

async function collect(session: Awaited<ReturnType<Agent['newSession']>>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of session.events()) events.push(event)
  return events
}

function stripAnsi(value: string): string {
  let output = ''
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === '[') {
      index += 2
      while (index < value.length) {
        const code = value.charCodeAt(index)
        if (code >= 0x40 && code <= 0x7e) break
        index += 1
      }
    } else {
      output += value[index] ?? ''
    }
  }
  return output
}
