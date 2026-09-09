import { describe, expect, it } from 'vitest'
import { createDeterministicEnv } from '../../src/env.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import { projectTranscript } from '../../src/tui/projection.js'
import { collectEvents } from '../helpers.js'

const capabilities = { color: 'mono' as const, unicode: false, width: 80 }

async function recordedWrite() {
  const env = createDeterministicEnv(
    [toolCall('write-1', 'write', { path: 'a.txt', content: 'hello' }), text('done')],
    { approvals: [{ decision: 'allow', grantScope: 'once' }] },
  )
  const session = await Agent.open({ cwd: '/workspace', env }).newSession()
  await session.turn('write a file')
  return collectEvents(session)
}

describe('TUI tool lifecycle', () => {
  it('distinguishes preparation, approval, dispatch and completion from recorded events', async () => {
    const events = await recordedWrite()
    for (const [type, status] of [
      ['tool.call', 'pending'],
      ['permission.requested', 'approval'],
      ['permission.decided', 'pending'],
      ['tool.intent', 'running'],
    ] as const) {
      const index = events.findIndex((event) => event.type === type)
      expect(index).toBeGreaterThan(-1)
      expect(
        projectTranscript(events.slice(0, index + 1), capabilities).activeTools[0]?.status,
      ).toBe(status)
    }
    expect(projectTranscript(events, capabilities).activeTools).toEqual([])
  })

  it('does not keep unresolved tools spinning after a terminal event', async () => {
    const events = (await recordedWrite()).filter((event) => event.type !== 'tool.result')
    expect(projectTranscript(events, capabilities).activeTools).toEqual([])
  })

  it('a queued turn cancellation does not hide the running turn tool', async () => {
    const events = await recordedWrite()
    const index = events.findIndex((event) => event.type === 'tool.intent')
    const active = events.slice(0, index + 1)
    expect(
      projectTranscript(
        [
          ...active,
          {
            type: 'turn.cancelled',
            turnId: 'another-queued-turn',
            seq: 999,
          },
        ],
        capabilities,
      ).activeTools[0]?.status,
    ).toBe('running')
  })
})
