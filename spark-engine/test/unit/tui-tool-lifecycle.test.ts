import { describe, expect, it } from 'vitest'
import { createDeterministicEnv } from '../../src/env.js'
import type { AgentEvent } from '../../src/events/schema.js'
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

  it('shows the recorded stream root cause instead of only the wrapper error', () => {
    const failure: AgentEvent = {
      schemaVersion: 1,
      sessionId: 'session-1',
      seq: 1,
      ts: 1,
      type: 'turn.failed',
      turnId: 'turn-1',
      error: {
        code: 'llm.partial_stream_failed',
        message: 'failed after emitting output',
        retryable: false,
        detail: {
          cause: {
            code: 'llm.anthropic.bridge_stream_error',
            message: 'socket reset by peer',
            detail: { requestId: 'req-test-1' },
          },
        },
      },
      recoveryHint: 'generic old hint',
    }

    const row = projectTranscript([failure], capabilities).settled[0]?.text
    expect(row).toContain('根因 llm.anthropic.bridge_stream_error: socket reset by peer')
    expect(row).toContain('request-id req-test-1')
    expect(row).toContain('可直接重试')
    expect(row).not.toContain('generic old hint')
  })

  it('explains repeated malformed tool output and identifies the routed model', () => {
    const failure: AgentEvent = {
      schemaVersion: 1,
      sessionId: 'session-1',
      seq: 2,
      ts: 2,
      type: 'turn.failed',
      turnId: 'turn-2',
      error: {
        code: 'llm.partial_stream_failed',
        message: 'failed after retrying malformed output',
        retryable: false,
        detail: {
          cause: {
            code: 'llm.anthropic.invalid_tool_json',
            message: 'Provider stream contained invalid JSON',
            detail: { responseModel: 'random/free-model', requestId: 'req-2' },
          },
        },
      },
    }

    const row = projectTranscript([failure], capabilities).settled[0]?.text
    expect(row).toContain('实际模型 random/free-model')
    expect(row).toContain('工具参数生成连续失败')
    expect(row).toContain('降低推理强度')
  })
})
