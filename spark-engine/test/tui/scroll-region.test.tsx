import { Box, Text } from 'ink'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import type { AgentEvent } from '../../src/events/schema.js'
import { createDeterministicEnv } from '../../src/env.js'
import { InteractiveApprover } from '../../src/permission/interactive.js'
import { RulePermissionPolicy } from '../../src/permission/policy.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import type { LlmService } from '../../src/seams.js'
import { Agent } from '../../src/sdk/agent.js'
import { SparkTuiApp } from '../../src/tui/app.js'
import {
  ScrollRegion,
  isWheelTrackingEnabled,
  parseMouseWheelDelta,
} from '../../src/tui/components/scroll-region.js'

describe('TUI output scrolling', () => {
  it('keeps terminal mouse tracking off by default so native selection works', () => {
    expect(isWheelTrackingEnabled({})).toBe(false)
    expect(isWheelTrackingEnabled({ SPARK_TUI_MOUSE: undefined })).toBe(false)
    expect(isWheelTrackingEnabled({ SPARK_TUI_MOUSE: '0' })).toBe(false)
    expect(isWheelTrackingEnabled({ SPARK_TUI_MOUSE: 'yes' })).toBe(false)
    expect(isWheelTrackingEnabled({ SPARK_TUI_MOUSE: '1' })).toBe(true)
    expect(isWheelTrackingEnabled({ SPARK_TUI_MOUSE: 'true' })).toBe(true)
  })

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

  it('emits no frames for wheel events at the scroll boundaries', async () => {
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
    const framesAtRest = app.frames.length

    // Parked at the bottom: further wheel-downs must not produce frames.
    for (let index = 0; index < 10; index += 1) app.stdin.write('\u001b[<65;20;8M')
    await settle()
    expect(app.frames.length).toBe(framesAtRest)

    // Wheel up to the top, then hammer wheel-up at that boundary too.
    for (let index = 0; index < 8; index += 1) app.stdin.write('\u001b[<64;20;8M')
    await settle()
    const framesAtTop = app.frames.length
    for (let index = 0; index < 10; index += 1) app.stdin.write('\u001b[<64;20;8M')
    await settle()
    expect(app.frames.length).toBe(framesAtTop)
    app.unmount()
  })

  it('keeps the transcript viewport still while a turn runs without model output', async () => {
    // Regression lock for "scrolled to the bottom, but the scroll content keeps
    // refreshing": only the busy line at the very bottom of the viewport and
    // the status bar below it may animate. Every settled transcript row above
    // them must stay byte-identical across spinner frames.
    const base = createDeterministicEnv([
      text(Array.from({ length: 30 }, (_, index) => `reply line ${index + 1}`).join('\n'), {
        chunkSize: 24,
      }),
      text('later reply'),
    ])
    const approver = new InteractiveApprover()
    const env = {
      ...base,
      llm: stallModel(base.llm, 1200),
      permission: { policy: new RulePermissionPolicy(), approver },
    }
    const agent = Agent.open({ cwd: '/workspace', env })
    const session = await agent.newSession()
    await session.turn('first reply')
    const initial = await collect(session)
    // Unicode glyphs give the status bar a real multi-frame spinner; if any
    // animation leaked into the transcript this test catches it.
    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        capabilities={{ color: 'truecolor', unicode: true, width: 80, height: 12 }}
      />,
    )
    await settle()

    app.stdin.write('follow up')
    await settle(3)
    app.stdin.write('\r')
    await settle(12)
    const baseline = app.frames.at(-1)
    expect(baseline).toBeDefined()
    const stallStart = app.frames.length

    // The turn runs (spinner animates in the status bar) but no deltas arrive.
    await sleep(900)
    const changed = app.frames.slice(stallStart).filter((frame) => frame !== baseline)
    expect(changed.length).toBeGreaterThan(0) // the spinner really is animating
    for (const frame of changed) {
      const beforeRows = (baseline ?? '').split('\n')
      const afterRows = frame.split('\n')
      const busyRow = beforeRows.findIndex((row) => row.includes('请求模型'))
      expect(busyRow).toBeGreaterThan(0)
      // Nothing above the busy line may change...
      expect(afterRows.slice(0, busyRow)).toEqual(beforeRows.slice(0, busyRow))
      // ...and the input box under it stays frozen too; only the busy line and
      // the status bar are animated.
      expect(afterRows.slice(busyRow + 1, -1)).toEqual(beforeRows.slice(busyRow + 1, -1))
    }
    app.unmount()
  })
})

/** Fake model that stays silent for a while before streaming (tool-wait shape). */
function stallModel(inner: LlmService, stallMs: number): LlmService {
  return {
    async *stream(request, context) {
      await new Promise((resolve) => setTimeout(resolve, stallMs))
      yield* inner.stream(request, context)
    },
  }
}

async function settle(ticks = 8): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
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
