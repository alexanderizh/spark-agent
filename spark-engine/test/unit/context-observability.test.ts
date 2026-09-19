import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { TurnMachine } from '../../src/kernel/turn-machine.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import type { LlmCallContext, LlmService } from '../../src/seams.js'
import { contextStatsLine } from '../../src/tui/projection.js'
import type { AgentEvent } from '../../src/events/schema.js'
import { formatModelLimitsTail } from '../../src/cli/diagnostics.js'

describe('turn stats context observability', () => {
  it('reports the route context window and the final step input usage', async () => {
    const base = createDeterministicEnv([text('answer', { usage: { inputTokens: 1_234 } })])
    const budgeted: LlmService = {
      stream: (request: Parameters<LlmService['stream']>[0], context: LlmCallContext) =>
        base.fixtures.model.stream(request, context),
      getModelBudget: () => ({ contextWindowTokens: 200_000, maxOutputTokens: 8_192 }),
    }
    const machine = new TurnMachine({ ...base, llm: budgeted })

    const result = await machine.run({
      sessionId: 's1',
      turnId: 't1',
      input: 'question',
      cwd: '/ws',
      permissionMode: 'auto',
    })

    expect(result.terminal.type).toBe('turn.completed')
    if (result.terminal.type !== 'turn.completed') return
    expect(result.terminal.stats.contextWindowTokens).toBe(200_000)
    expect(result.terminal.stats.lastInputTokens).toBe(1_234)
  })

  it('omits window and last-input fields when there is nothing real to report', async () => {
    const base = createDeterministicEnv([text('answer', { usage: { inputTokens: 0 } })])
    const machine = new TurnMachine(base)

    const result = await machine.run({
      sessionId: 's1',
      turnId: 't1',
      input: 'question',
      cwd: '/ws',
      permissionMode: 'auto',
    })

    expect(result.terminal.type).toBe('turn.completed')
    if (result.terminal.type !== 'turn.completed') return
    expect(result.terminal.stats.contextWindowTokens).toBeUndefined()
    expect(result.terminal.stats.lastInputTokens).toBeUndefined()
  })
})

describe('contextStatsLine', () => {
  function assistantEvent(inputTokens: number, cacheReadTokens: number): AgentEvent {
    return {
      schemaVersion: 1,
      sessionId: 's1',
      seq: 1,
      ts: 1,
      type: 'assistant.completed',
      turnId: 't1',
      stepId: 'step-1',
      message: { text: 'ok', toolCalls: [] },
      usage: {
        inputTokens,
        outputTokens: 1,
        cacheReadTokens,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
      llmMs: 1,
      ttftMs: 1,
    }
  }

  it('shows window share when the budget is known', () => {
    const line = contextStatsLine([assistantEvent(50_000, 40_000)], 200_000)
    expect(line).toContain('ctx≈50000/200000 tok (25%)')
    expect(line).toContain('缓存命中 80%')
  })

  it('falls back to a bare footprint without a window', () => {
    const line = contextStatsLine([assistantEvent(50_000, 40_000)])
    expect(line).toContain('ctx≈50000 tok')
    expect(line).not.toContain('/200000')
  })
})

describe('formatModelLimitsTail', () => {
  it('renders both limits, either one, or nothing', () => {
    expect(formatModelLimitsTail({ contextWindowTokens: 200_000, maxOutputTokens: 8_192 })).toBe(
      '  ctx 200000 · out 8192',
    )
    expect(formatModelLimitsTail({ contextWindowTokens: 200_000 })).toBe('  ctx 200000')
    expect(formatModelLimitsTail({})).toBe('')
  })
})
