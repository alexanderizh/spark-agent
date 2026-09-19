import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { Agent } from '../../src/sdk/agent.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'

const BUDGET = { maxInputTokens: 100 }

describe('budget continuation chain', () => {
  it('chains follow-up turns while the budget keeps stopping and budget remains', async () => {
    // Every step consumes 150 input tokens against a 100-token budget, so each
    // turn stops on budget; autoContinue: 2 chains exactly two follow-ups.
    // Budget stops only fire on multi-step turns, so each turn opens with a
    // tool call.
    const base = createDeterministicEnv([
      toolCall('c1', 'read', { path: 'a.ts' }, { usage: { inputTokens: 150 } }),
      toolCall('c2', 'read', { path: 'b.ts' }, { usage: { inputTokens: 150 } }),
      toolCall('c3', 'read', { path: 'c.ts' }, { usage: { inputTokens: 150 } }),
    ])
    const agent = Agent.open({ cwd: '/ws', env: base })
    const session = await agent.newSession({ permissionMode: 'auto' })

    const result = await session.turn('long task', { budget: BUDGET, autoContinue: 2 })

    expect(result.terminal.type).toBe('turn.completed')
    if (result.terminal.type !== 'turn.completed') return
    expect(result.terminal.reason).toBe('budget')
    expect(base.fixtures.model.requests).toHaveLength(3)
    // The continuation turns start from the continuation prompt, not the
    // original task text.
    const continuationInput = base.fixtures.model.requests[1]?.messages.at(-1)
    expect(
      continuationInput?.role === 'user' && continuationInput.content.includes('自动继续'),
    ).toBe(true)
  })

  it('does not continue when autoContinue is absent', async () => {
    const base = createDeterministicEnv([
      toolCall('c1', 'read', { path: 'a.ts' }, { usage: { inputTokens: 150 } }),
    ])
    const agent = Agent.open({ cwd: '/ws', env: base })
    const session = await agent.newSession({ permissionMode: 'auto' })

    const result = await session.turn('long task', { budget: BUDGET })

    expect(result.terminal.type).toBe('turn.completed')
    if (result.terminal.type !== 'turn.completed') return
    expect(result.terminal.reason).toBe('budget')
    expect(base.fixtures.model.requests).toHaveLength(1)
  })

  it('returns the final answer when a continuation completes the task', async () => {
    const base = createDeterministicEnv([
      toolCall('c1', 'read', { path: 'a.ts' }, { usage: { inputTokens: 150 } }),
      text('part 2 — task finished'),
    ])
    const agent = Agent.open({ cwd: '/ws', env: base })
    const session = await agent.newSession({ permissionMode: 'auto' })

    const result = await session.turn('long task', { budget: BUDGET, autoContinue: 3 })

    expect(result.terminal.type).toBe('turn.completed')
    if (result.terminal.type !== 'turn.completed') return
    expect(result.terminal.reason).toBe('final')
    expect(base.fixtures.model.requests).toHaveLength(2)
  })

  it('stops chaining after a terminal that is not a budget stop', async () => {
    // Cancellation during a continuation must not trigger more continuations.
    const base = createDeterministicEnv([
      text('part 1', { usage: { inputTokens: 150 } }),
      text('part 2', { usage: { inputTokens: 150 } }),
    ])
    const agent = Agent.open({ cwd: '/ws', env: base })
    const session = await agent.newSession({ permissionMode: 'auto' })
    const controller = new AbortController()
    controller.abort()

    const result = await session.turn('long task', {
      budget: BUDGET,
      autoContinue: 3,
      signal: controller.signal,
    })

    expect(result.terminal.type).toBe('turn.cancelled')
    expect(base.fixtures.model.requests).toHaveLength(0)
  })
})
