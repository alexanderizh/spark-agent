import { describe, expect, it } from 'vitest'

import { AgentEventSchema, type AgentEvent, type BoundEventDraft } from '../../src/events/schema.js'
import { EventContextProjector } from '../../src/events/projector.js'
import { KernelError } from '../../src/kernel/errors.js'
import {
  DEFAULT_COMPACTION_POLICY,
  isContextOverflowError,
  planCompaction,
  turnRanges,
} from '../../src/kernel/compaction.js'
import type { ContextCompactionPolicy } from '../../src/seams.js'

function event(input: BoundEventDraft, seq: number): AgentEvent {
  return AgentEventSchema.parse({ ...input, sessionId: 's1', seq, ts: seq })
}

function turnStarted(turnId: string, seq: number, text: string): AgentEvent {
  return event(
    { type: 'turn.started', schemaVersion: 1, turnId, input: { kind: 'text', text } },
    seq,
  )
}

function assistant(turnId: string, seq: number, text: string): AgentEvent {
  return event(
    {
      type: 'assistant.completed',
      schemaVersion: 1,
      turnId,
      stepId: `step-${seq}`,
      message: { text, toolCalls: [] },
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
      llmMs: 1,
      ttftMs: 1,
    },
    seq,
  )
}

function toolExchange(turnId: string, seq: number, callId: string): AgentEvent[] {
  return [
    event(
      {
        type: 'assistant.completed',
        schemaVersion: 1,
        turnId,
        stepId: `step-${seq}`,
        message: { text: '', toolCalls: [{ callId, name: 'read', args: { path: 'a.ts' } }] },
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
        llmMs: 1,
        ttftMs: 1,
      },
      seq,
    ),
    event(
      {
        type: 'tool.call',
        schemaVersion: 1,
        stepId: `step-${seq}`,
        callId,
        tool: 'read',
        args: { path: 'a.ts' },
      },
      seq + 1,
    ),
    event(
      {
        type: 'tool.result',
        schemaVersion: 1,
        callId,
        durationMs: 1,
        ok: true,
        content: 'file body'.repeat(400),
      },
      seq + 2,
    ),
  ]
}

const policy: ContextCompactionPolicy = {
  ...DEFAULT_COMPACTION_POLICY,
  keepRecentTurns: 1,
  minCompactableTokens: 10,
}

const tinyPolicy: ContextCompactionPolicy = {
  ...policy,
  minCompactableTokens: 100_000,
}

function history(): AgentEvent[] {
  // turn t1: user + tool exchange; turn t2: user + assistant answer
  const events: AgentEvent[] = [
    event(
      {
        type: 'session.started',
        schemaVersion: 1,
        engineVersion: '0.0.0-test',
        cwd: '/ws',
        configSnapshot: '{}',
      },
      0,
    ),
    turnStarted('t1', 1, 'do the thing'),
    ...toolExchange('t1', 2, 'c1'),
    turnStarted('t2', 5, 'now finish'),
    assistant('t2', 6, 'finished'),
  ]
  return events
}

describe('turnRanges', () => {
  it('bounds each turn at the next turn start', () => {
    const ranges = turnRanges(history())
    expect(ranges).toEqual([
      { turnId: 't1', fromSeq: 1, toSeq: 5 },
      { turnId: 't2', fromSeq: 5, toSeq: 7 },
    ])
  })
})

describe('planCompaction', () => {
  it('drops the oldest turns and the finished exchanges of the active turn', () => {
    const messages = new EventContextProjector().project(history(), { cwd: '/ws' }).messages
    const plan = planCompaction(messages, history(), policy)
    expect(plan).toBeDefined()
    expect(plan?.dropped[0]).toEqual({ turnId: 't1', fromSeq: 1, toSeq: 5 })
    // The active turn contributes its finished exchanges (here: the leading
    // user message before the last assistant boundary) but never its final
    // exchange.
    const last = plan?.dropped.at(-1)
    expect(last?.turnId).toBe('t2')
    expect(last?.toSeq).toBeLessThanOrEqual(6)
    expect(plan?.droppedTokens).toBeGreaterThan(10)
    expect(plan?.remainingTokens).toBeGreaterThan(0)
  })

  it('refuses to compact when the droppable part is too small', () => {
    const events: AgentEvent[] = [
      turnStarted('t1', 0, 'tiny'),
      assistant('t1', 1, 'ok'),
      turnStarted('t2', 2, 'tiny two'),
      assistant('t2', 3, 'ok two'),
    ]
    const messages = new EventContextProjector().project(events, { cwd: '/ws' }).messages
    expect(planCompaction(messages, events, tinyPolicy)).toBeUndefined()
  })

  it('ignores the size floor when forced', () => {
    const events: AgentEvent[] = [
      turnStarted('t1', 0, 'tiny'),
      assistant('t1', 1, 'ok'),
      turnStarted('t2', 2, 'tiny two'),
      assistant('t2', 3, 'ok two'),
    ]
    const messages = new EventContextProjector().project(events, { cwd: '/ws' }).messages
    const plan = planCompaction(messages, events, tinyPolicy, { force: true })
    expect(plan?.dropped.length).toBeGreaterThan(0)
  })

  it('declines when there is nothing droppable', () => {
    // A single exchange only: its whole content is the live final segment.
    const events: AgentEvent[] = [turnStarted('t1', 0, 'only exchange')]
    const messages = new EventContextProjector().project(events, { cwd: '/ws' }).messages
    expect(planCompaction(messages, events, tinyPolicy, { force: true })).toBeUndefined()
  })
})

describe('projector replay of context.compacted', () => {
  it('replaces dropped ranges with the summary and keeps later turns', () => {
    const projector = new EventContextProjector()
    const events: AgentEvent[] = [
      ...history(),
      event(
        {
          type: 'context.compacted',
          schemaVersion: 1,
          summary: 'The user asked to do the thing; the file a.ts was read.',
          droppedRanges: [[1, 5]],
        },
        7,
      ),
    ]
    const messages = projector.project(events, { cwd: '/ws' }).messages
    expect(messages).toHaveLength(3)
    expect(messages[0]).toMatchObject({ role: 'user', content: 'now finish' })
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'finished' })
    expect(messages[2]).toMatchObject({ role: 'user' })
    expect(messages[2]?.role === 'user' && messages[2].content).toContain('<context-summary>')
    expect(messages[2]?.role === 'user' && messages[2].content).toContain('a.ts')
    // No orphaned tool_result survives its dropped tool_use.
    expect(messages.some((message) => message.role === 'tool_result')).toBe(false)
  })

  it('retires an older summary when a later compaction covers its range', () => {
    const projector = new EventContextProjector()
    const events: AgentEvent[] = [
      turnStarted('t1', 0, 'first'),
      assistant('t1', 1, 'a'),
      turnStarted('t2', 2, 'second'),
      assistant('t2', 3, 'b'),
      event(
        {
          type: 'context.compacted',
          schemaVersion: 1,
          summary: 'summary one',
          droppedRanges: [[0, 2]],
        },
        4,
      ),
      turnStarted('t3', 5, 'third'),
      assistant('t3', 6, 'c'),
      event(
        {
          type: 'context.compacted',
          schemaVersion: 1,
          summary: 'summary two',
          droppedRanges: [[2, 7]],
        },
        7,
      ),
    ]
    const messages = projector.project(events, { cwd: '/ws' }).messages
    const summaries = messages.filter(
      (message) => message.role === 'user' && message.content.includes('<context-summary>'),
    )
    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.role === 'user' && summaries[0].content).toContain('summary two')
  })
})

describe('isContextOverflowError', () => {
  it('recognizes the engine guard, provider codes, and message variants', () => {
    expect(
      isContextOverflowError(
        new KernelError('llm.context_window_exhausted', 'prompt too big', { retryable: false }),
      ),
    ).toBe(true)
    expect(
      isContextOverflowError(
        new KernelError(
          'llm.anthropic.invalid_request_error',
          'prompt is too long: 300000 tokens > 200000',
          {
            retryable: false,
          },
        ),
      ),
    ).toBe(true)
    const nested = new KernelError('llm.openai.response_failed', 'request failed', {
      retryable: false,
      detail: { cause: { code: 'context_length_exceeded' } },
    })
    expect(isContextOverflowError(nested)).toBe(true)
    expect(
      isContextOverflowError(
        new KernelError('llm.anthropic.rate_limit_error', 'rate limited', { retryable: true }),
      ),
    ).toBe(false)
    expect(isContextOverflowError(new Error('connection reset'))).toBe(false)
  })
})
