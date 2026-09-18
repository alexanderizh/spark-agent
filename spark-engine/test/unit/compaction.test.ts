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
import type { IrMessage } from '../../src/llm/types.js'

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

// ---------------------------------------------------------------------------
// Microcompact
// ---------------------------------------------------------------------------

import { planMicrocompact, slimmedStub } from '../../src/kernel/compaction.js'

function toolResultMessage(
  callId: string,
  seqs: readonly number[],
  content: string,
): Extract<IrMessage, { role: 'tool_result' }> {
  return { role: 'tool_result', callId, tool: 'read', ok: true, content, sourceSeqs: seqs }
}

describe('planMicrocompact', () => {
  const microPolicy: ContextCompactionPolicy = {
    ...DEFAULT_COMPACTION_POLICY,
    microcompactKeepExchanges: 2,
    microcompactMinTokens: 100,
  }
  const bigBody = 'x'.repeat(1_000)
  const tinyBody = 'x'.repeat(10)

  function eventsWithExchanges(exchangeCount: number, toolSeq: number): AgentEvent[] {
    const events: AgentEvent[] = []
    for (let index = 0; index < exchangeCount; index += 1) {
      events.push(assistant('t1', (index + 1) * 10, `exchange ${index}`))
    }
    void toolSeq
    return events
  }

  it('slims tool results older than the keep window and skips fresh or tiny ones', () => {
    // assistant boundaries at 10, 20; tool results at 5 (stale), 15 (fresh), 25 (fresh)
    const messages = [
      toolResultMessage('old', [5], bigBody),
      toolResultMessage('fresh', [15], bigBody),
      toolResultMessage('tiny', [5], tinyBody),
    ]
    const events = eventsWithExchanges(2, 0)
    const plan = planMicrocompact(messages, events, microPolicy)
    expect(plan.map((candidate) => candidate.callId)).toEqual(['old'])
  })

  it('returns nothing when disabled', () => {
    const messages = [toolResultMessage('old', [5], bigBody)]
    const events = eventsWithExchanges(2, 0)
    expect(
      planMicrocompact(messages, events, { ...microPolicy, microcompactEnabled: false }),
    ).toEqual([])
  })

  it('does not slim failed tool results', () => {
    const messages: IrMessage[] = [
      {
        role: 'tool_result',
        callId: 'bad',
        tool: 'read',
        ok: false,
        content: bigBody,
        sourceSeqs: [5],
      },
    ]
    const events = eventsWithExchanges(2, 0)
    expect(planMicrocompact(messages, events, microPolicy)).toEqual([])
  })

  it('formats the stub with head, artifact hint, and tail', () => {
    const body = `${'head'.repeat(200)}${'tail'.repeat(100)}`
    const stub = slimmedStub(body, 'spark artifact read: sha256:abc (1234 bytes)', 900)
    expect(stub).toContain('microcompacted')
    expect(stub).toContain('Full output: spark artifact read: sha256:abc (1234 bytes)')
    expect(stub).toContain('tail'.repeat(100).slice(-100))
    expect(stub.length).toBeLessThan(body.length)
  })
})

describe('projector replay of context.tool_results_slimmed', () => {
  it('patches the surviving tool_result and keeps later content intact', () => {
    const projector = new EventContextProjector()
    const events: AgentEvent[] = [
      turnStarted('t1', 0, 'start'),
      assistant('t1', 1, ''),
      event(
        { type: 'tool.call', schemaVersion: 1, stepId: 's1', callId: 'c1', tool: 'read', args: {} },
        2,
      ),
      event(
        {
          type: 'tool.result',
          schemaVersion: 1,
          callId: 'c1',
          durationMs: 1,
          ok: true,
          content: 'huge body'.repeat(200),
        },
        3,
      ),
      assistant('t1', 4, 'intermediate'),
      event(
        {
          type: 'context.tool_results_slimmed',
          schemaVersion: 1,
          slimmed: [
            {
              callId: 'c1',
              fullRef: {
                sha256: 'a'.repeat(64),
                bytes: 9,
                mediaType: 'text/plain',
                summary: 'tool output',
                readHint: 'spark artifact read: c1',
              },
              slimmedContent: 'stub head… Full output: spark artifact read: c1 …stub tail',
              savedTokens: 1200,
            },
          ],
        },
        5,
      ),
      assistant('t1', 6, 'final'),
    ]
    const messages = projector.project(events, { cwd: '/ws' }).messages
    const slimmed = messages.find(
      (message) => message.role === 'tool_result' && message.callId === 'c1',
    )
    expect(slimmed?.role === 'tool_result' && slimmed.content).toContain(
      'Full output: spark artifact read: c1',
    )
    expect(slimmed?.role === 'tool_result' && slimmed.content).not.toContain('huge body')
    const last = messages.at(-1)
    expect(last).toMatchObject({ role: 'assistant', content: 'final' })
  })

  it('still patches a tool_result that survives an earlier compaction', () => {
    const projector = new EventContextProjector()
    // The first assistant exchange (seq 1) is compacted away; the tool result
    // at seq 3-4 survives and its slot index shifts down after the rebuild —
    // the slim patch must land on the right message regardless.
    const events: AgentEvent[] = [
      turnStarted('t1', 0, 'first'),
      assistant('t1', 1, 'first exchange'),
      assistant('t1', 2, 'second exchange'),
      event(
        { type: 'tool.call', schemaVersion: 1, stepId: 's2', callId: 'c1', tool: 'read', args: {} },
        3,
      ),
      event(
        {
          type: 'tool.result',
          schemaVersion: 1,
          callId: 'c1',
          durationMs: 1,
          ok: true,
          content: 'kept body',
        },
        4,
      ),
      assistant('t1', 5, 'third exchange'),
      turnStarted('t2', 6, 'second'),
      assistant('t2', 7, 'second answer'),
      event(
        {
          type: 'context.compacted',
          schemaVersion: 1,
          summary: 'earlier summarized',
          droppedRanges: [[0, 2]],
        },
        8,
      ),
      event(
        {
          type: 'context.tool_results_slimmed',
          schemaVersion: 1,
          slimmed: [
            {
              callId: 'c1',
              fullRef: {
                sha256: 'b'.repeat(64),
                bytes: 9,
                mediaType: 'text/plain',
                summary: 'tool output',
                readHint: 'spark artifact read: c1',
              },
              slimmedContent: 'slimmed after compaction',
              savedTokens: 300,
            },
          ],
        },
        7,
      ),
    ]
    const messages = projector.project(events, { cwd: '/ws' }).messages
    const slimmed = messages.find(
      (message) => message.role === 'tool_result' && message.callId === 'c1',
    )
    expect(slimmed?.role === 'tool_result' && slimmed.content).toBe('slimmed after compaction')
    // Exactly one tool_result message survived, and it is the patched one.
    expect(messages.filter((message) => message.role === 'tool_result')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Hierarchical (chunked) summarization
// ---------------------------------------------------------------------------

import { chunkMessages, ContextCompactor } from '../../src/kernel/compaction.js'
import { createDeterministicEnv } from '../../src/env.js'
import { text } from '../../src/llm/fake/reply-dsl.js'

describe('chunkMessages', () => {
  const message = (content: string): IrMessage => ({
    role: 'user',
    content,
    sourceSeqs: [0],
  })

  it('splits greedily under the cap and keeps every message', () => {
    const input = [message('a'.repeat(300)), message('b'.repeat(300)), message('c'.repeat(300))]
    // cap = 2 messages worth (each ≈112 tokens incl. framing)
    const chunks = chunkMessages(input, 250)
    expect(chunks).toHaveLength(2)
    expect(chunks.flat()).toEqual(input)
  })

  it('keeps one oversized message as its own chunk', () => {
    const input = [message('x'.repeat(9_000)), message('y'.repeat(10))]
    const chunks = chunkMessages(input, 100)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual([input[0]])
  })

  it('returns no chunks for empty input', () => {
    expect(chunkMessages([], 1_000)).toEqual([])
  })
})

describe('ContextCompactor chunked summarization', () => {
  function bigAssistant(turnId: string, seq: number, text: string): AgentEvent {
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

  it('summarizes oversized dropped content per chunk and reduces the intermediates', async () => {
    // Two dropped bodies of ~34k tokens each exceed the 60k cap together.
    const bodyOne = `body-one ${'a'.repeat(100_000)}`
    const bodyTwo = `body-two ${'b'.repeat(100_000)}`
    const events: AgentEvent[] = [
      turnStarted('t1', 0, 'long turn'),
      bigAssistant('t1', 1, bodyOne),
      bigAssistant('t1', 2, bodyTwo),
      turnStarted('t2', 3, 'current turn'),
      assistant('t2', 4, 'current answer'),
    ]
    const base = createDeterministicEnv([
      text('segment one digest'),
      text('segment two digest'),
      text('final reduced summary of both segments'),
    ])
    const policy: ContextCompactionPolicy = { ...DEFAULT_COMPACTION_POLICY, keepRecentTurns: 1 }
    const outcome = await new ContextCompactor(base, policy).compact({
      sessionId: 's1',
      cwd: '/ws',
      events,
      ledger: new (await import('../../src/events/ledger.js')).SessionLedger(
        's1',
        base.store,
        base.clock,
      ),
      force: true,
    })
    if (!('event' in outcome)) throw new Error(`compaction skipped: ${JSON.stringify(outcome)}`)

    expect(base.fixtures.model.requests).toHaveLength(3)
    const [first, second, reduce] = base.fixtures.model.requests
    const textOf = (request: typeof first): string =>
      request?.messages
        .map((message) => (message.role === 'user' ? message.content : ''))
        .join('\n') ?? ''
    expect(textOf(first)).toContain('body-one')
    expect(textOf(first)).not.toContain('body-two')
    expect(textOf(second)).toContain('body-two')
    expect(textOf(second)).not.toContain('body-one')
    // The reduce pass consumes the intermediates, not the raw bodies.
    expect(textOf(reduce)).toContain('segment one digest')
    expect(textOf(reduce)).toContain('segment two digest')
    expect(textOf(reduce)).not.toContain('body-one')
    expect(textOf(reduce)).not.toContain('body-two')

    expect(outcome.summary).toBe('final reduced summary of both segments')
    expect(outcome.event.type).toBe('context.compacted')
    if (outcome.event.type === 'context.compacted') {
      expect(outcome.event.summary).toBe('final reduced summary of both segments')
    }
    // The chunked pass is observable.
    expect(
      base.fixtures.telemetry.records.some(
        (record) => record.name === 'context.compaction.chunked' && record.attributes?.chunks === 2,
      ),
    ).toBe(true)
  })
})
