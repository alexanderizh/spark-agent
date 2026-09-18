import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { TurnMachine } from '../../src/kernel/turn-machine.js'
import { Agent } from '../../src/sdk/agent.js'
import type { SessionStore } from '../../src/seams.js'
import { fail, text, toolCall } from '../../src/llm/fake/reply-dsl.js'

const OVERFLOW_MESSAGE = 'prompt is too long: 300000 tokens > 200000 maximum context length'

describe('turn context compaction', () => {
  it('auto-compacts mid-turn when the reported input usage crosses the threshold', async () => {
    const base = createDeterministicEnv([
      toolCall('c1', 'read', { path: 'a.ts' }, { usage: { inputTokens: 95_000 } }),
      toolCall('c2', 'read', { path: 'b.ts' }, { usage: { inputTokens: 190_000 } }),
      text('summary: user asked for a refactor; a.ts and b.ts were read'),
      text('done'),
    ])
    const machine = new TurnMachine({
      ...base,
      context: { compaction: { minCompactableTokens: 10 } },
    })

    const result = await machine.run({
      sessionId: 's1',
      turnId: 't1',
      input: 'long running task',
      cwd: '/ws',
      permissionMode: 'auto',
    })

    expect(result.terminal.type).toBe('turn.completed')
    if (result.terminal.type !== 'turn.completed') return
    expect(result.terminal.stats.compactions).toBe(1)

    // Calls 1-2: normal steps. Call 3: the summarizer. Call 4: the retry step.
    expect(base.fixtures.model.requests).toHaveLength(4)
    const summaryRequest = base.fixtures.model.requests[2]
    expect(summaryRequest?.system[0]?.id).toBe('compaction-summary')
    const finalRequest = base.fixtures.model.requests[3]
    const finalUserTexts = (
      finalRequest?.messages.filter((message) => message.role === 'user') ?? []
    )
      .map((message) => (message.role === 'user' ? message.content : ''))
      .join('\n')
    expect(finalUserTexts).toContain('<context-summary>')
    expect(finalUserTexts).toContain('user asked for a refactor')
    // The summarized prefix must not be replayed verbatim.
    expect(finalUserTexts).not.toContain('long running task')
  })

  it('recovers a step rejected for context length by compacting and retrying', async () => {
    const base = createDeterministicEnv([
      text('first turn result'),
      text('second turn result'),
      fail('llm.openai.context_length_exceeded', { message: OVERFLOW_MESSAGE }),
      text('rescue summary of the earlier turns'),
      text('recovered answer'),
    ])
    const machine = new TurnMachine({ ...base, context: { compaction: { keepRecentTurns: 1 } } })

    await machine.run({
      sessionId: 's1',
      turnId: 't1',
      input: 'turn one',
      cwd: '/ws',
      permissionMode: 'auto',
    })
    await machine.run({
      sessionId: 's1',
      turnId: 't2',
      input: 'turn two',
      cwd: '/ws',
      permissionMode: 'auto',
    })
    const result = await machine.run({
      sessionId: 's1',
      turnId: 't3',
      input: 'turn three',
      cwd: '/ws',
      permissionMode: 'auto',
    })

    expect(result.terminal.type).toBe('turn.completed')
    if (result.terminal.type !== 'turn.completed') return
    expect(result.terminal.stats.compactions).toBe(1)
    // Call 3 failed with the overflow; call 4 is the summarizer; call 5 retries.
    expect(base.fixtures.model.requests).toHaveLength(5)
    const summaryRequest = base.fixtures.model.requests[3]
    expect(summaryRequest?.system[0]?.id).toBe('compaction-summary')
  })

  it('reads each ledger event at most once per turn instead of re-reading the whole log per step', async () => {
    const base = createDeterministicEnv([
      toolCall('c1', 'read', { path: 'a.ts' }),
      toolCall('c2', 'read', { path: 'b.ts' }),
      toolCall('c3', 'read', { path: 'c.ts' }),
      text('done'),
    ])
    let yielded = 0
    const inner = base.store
    const countingStore: SessionStore = {
      append: (sessionId, event) => inner.append(sessionId, event),
      read: async function* (sessionId, fromSeq) {
        for await (const event of inner.read(sessionId, fromSeq)) {
          yielded += 1
          yield event
        }
      },
      latestSeq: (sessionId) => inner.latestSeq(sessionId),
      fork: (sessionId, uptoSeq) => inner.fork(sessionId, uptoSeq),
      list: (projectDir, options) => inner.list(projectDir, options),
    }
    const machine = new TurnMachine({ ...base, store: countingStore })

    const result = await machine.run({
      sessionId: 's1',
      turnId: 't1',
      input: 'multi step task',
      cwd: '/ws',
      permissionMode: 'auto',
    })

    expect(result.terminal.type).toBe('turn.completed')
    const totalEvents = await (async () => {
      let count = 0
      for await (const _ignored of base.store.read('s1')) {
        count += 1
        void _ignored
      }
      return count
    })()
    // Incremental pulls read the log once overall (plus a small tail race
    // margin), never once per step.
    expect(yielded).toBeLessThanOrEqual(totalEvents + 1)
    expect(yielded).toBeGreaterThan(0)
  })

  it('supports manual compaction through AgentSession.compact()', async () => {
    const base = createDeterministicEnv([
      text('answer one with lots of detail'),
      text('answer two'),
      text('answer three after compaction'),
    ])
    const agent = Agent.open({
      env: { ...base, context: { compaction: { keepRecentTurns: 1 } } },
    })
    const session = await agent.newSession()
    await session.turn('first question')
    await session.turn('second question')

    const outcome = await session.compact()
    expect(outcome.compacted).toBe(true)
    // Both early turns fold into the summary; the current (turn-less) state
    // contributes nothing droppable yet.
    expect(outcome.droppedTurns).toBe(2)

    await session.turn('third question')
    const lastRequest = base.fixtures.model.requests.at(-1)
    const userTexts = (lastRequest?.messages.filter((message) => message.role === 'user') ?? [])
      .map((message) => (message.role === 'user' ? message.content : ''))
      .join('\n')
    expect(userTexts).toContain('<context-summary>')
    expect(userTexts).not.toContain('first question')
  })
})
