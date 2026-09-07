import { describe, expect, it } from 'vitest'

import { AgentEventSchema } from '../../src/events/schema.js'
import { createDeterministicEnv } from '../../src/env.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { Agent } from '../../src/sdk/agent.js'
import { collectEvents } from '../helpers.js'

describe('invariant: turn performance stats', () => {
  it('aggregates llmMs, keeps the first call ttft, and sums reasoning tokens', async () => {
    const env = createDeterministicEnv(
      [
        toolCall(
          'read-1',
          'read',
          { path: 'a.ts' },
          { timing: { llmMs: 1_000, ttftMs: 300 }, usage: { reasoningTokens: 40 } },
        ),
        text('done', { timing: { llmMs: 2_500, ttftMs: 120 }, usage: { reasoningTokens: 8 } }),
      ],
      {
        files: { 'a.ts': 'one' },
        approvals: [{ decision: 'allow', grantScope: 'once' }],
      },
    )
    const session = await Agent.open({ cwd: '/workspace', env }).newSession()
    await session.turn('inspect then answer')
    const events = await collectEvents(session)

    const assistants = events.filter((event) => event.type === 'assistant.completed')
    expect(assistants.map((event) => event.llmMs)).toEqual([1_000, 2_500])
    expect(assistants.map((event) => event.ttftMs)).toEqual([300, 120])

    const terminal = events.at(-1)
    if (terminal?.type !== 'turn.completed') throw new Error('expected turn.completed terminal')
    expect(terminal.stats.llmMs).toBe(3_500)
    // 首字耗时取本轮第一次模型调用（用户感知的首个 token）。
    expect(terminal.stats.ttftMs).toBe(300)
    expect(terminal.stats.usage.reasoningTokens).toBe(48)
  })

  it('replays legacy ledger events without timing fields using zero defaults', () => {
    const legacy = {
      schemaVersion: 1,
      sessionId: 's1',
      seq: 3,
      ts: 3,
      type: 'assistant.completed',
      stepId: 'step-1',
      turnId: 'turn-1',
      message: { text: 'hi', toolCalls: [] },
      usage: { inputTokens: 2, outputTokens: 3 },
    }
    const parsed = AgentEventSchema.parse(legacy)
    if (parsed.type !== 'assistant.completed') throw new Error('unexpected event type')
    expect(parsed.llmMs).toBe(0)
    expect(parsed.ttftMs).toBe(0)
    expect(parsed.usage.reasoningTokens).toBe(0)

    const legacyStats = AgentEventSchema.parse({
      schemaVersion: 1,
      sessionId: 's1',
      seq: 4,
      ts: 4,
      type: 'turn.completed',
      turnId: 'turn-1',
      reason: 'final',
      stats: {
        steps: 1,
        toolCalls: 0,
        usage: { inputTokens: 2, outputTokens: 3 },
        wallMs: 50,
      },
    })
    if (legacyStats.type !== 'turn.completed') throw new Error('unexpected event type')
    expect(legacyStats.stats.llmMs).toBe(0)
    expect(legacyStats.stats.ttftMs).toBe(0)
    expect(legacyStats.stats.usage.reasoningTokens).toBe(0)
  })
})
