import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { text, toolCall, toolCalls } from '../../src/llm/fake/reply-dsl.js'
import type { LlmDelta, LlmRequest } from '../../src/llm/types.js'
import { Agent } from '../../src/sdk/agent.js'
import type { LlmCallContext, LlmService } from '../../src/seams.js'
import { collectEvents } from '../helpers.js'

describe('invariant: task subagents', () => {
  it('uses an isolated child ledger and returns its final result', async () => {
    const env = createDeterministicEnv(
      [
        toolCall('task-1', 'task', {
          description: 'Inspect the workspace',
          prompt: 'Inspect the workspace and report what you find.',
        }),
        toolCall('child-write-1', 'write', { path: 'blocked.txt', content: 'must not write' }),
        text('The workspace was inspected successfully.'),
        text('Parent received the subagent result.'),
      ],
      { files: { 'a.ts': 'export const answer = 42;' } },
    )
    const agent = Agent.open({ cwd: '/workspace', env })
    const parent = await agent.newSession({ permissionMode: 'auto' })

    const result = await parent.turn('Ask a subagent to inspect the workspace.')
    const parentEvents = await collectEvents(parent)
    const childSessions = (await agent.listSessions({ includeSubagents: true })).filter(
      (session) => session.sessionId !== parent.sessionId,
    )

    expect(result.terminal.type).toBe('turn.completed')
    expect(env.fixtures.fs.exists('blocked.txt')).toBe(false)
    expect(parentEvents.find((event) => event.type === 'tool.result')).toMatchObject({
      ok: true,
      childSessionId: childSessions[0]?.sessionId,
      content: expect.stringContaining('The workspace was inspected successfully.'),
    })
    expect(childSessions).toHaveLength(1)
    expect((await agent.listSessions()).map((session) => session.sessionId)).toEqual([
      parent.sessionId,
    ])
    const allSessions = await agent.listSessions({ includeSubagents: true })
    expect(allSessions.map((session) => session.kind).sort()).toEqual(['main', 'subagent'])
    expect(allSessions.find((session) => session.kind === 'subagent')?.parentSessionId).toBe(
      parent.sessionId,
    )
    const childEvents = await readSession(env, childSessions[0]?.sessionId ?? '')
    const parentTurn = parentEvents.find((event) => event.type === 'turn.started')
    expect(childEvents.find((event) => event.type === 'turn.started')).toMatchObject({
      parentId: parentTurn?.type === 'turn.started' ? parentTurn.turnId : undefined,
    })
    expect(env.fixtures.model.requests[1]?.tools.map((tool) => tool.name)).toEqual(['read'])
    expect(env.fixtures.model.requests[1]?.tools.map((tool) => tool.name)).not.toContain('task')
  })

  it('allows explicit mutation tools but keeps the child budget separate', async () => {
    const env = createDeterministicEnv([
      toolCall('task-1', 'task', {
        description: 'Create a marker',
        prompt: 'Create the requested marker file, then summarize it.',
        allowed_tools: ['write'],
        max_steps: 1,
      }),
      toolCall('child-write-1', 'write', { path: 'marker.txt', content: 'created' }),
      text('Parent received the budget-limited result.'),
    ])
    const agent = Agent.open({ cwd: '/workspace', env })
    const parent = await agent.newSession({ permissionMode: 'auto' })

    await parent.turn('Delegate marker creation.')

    expect(env.fixtures.fs.read('marker.txt')).toBe('created')
    const parentEvents = await collectEvents(parent)
    expect(parentEvents.find((event) => event.type === 'tool.result')).toMatchObject({
      ok: false,
      content: expect.stringContaining('exhausted its budget'),
    })
    const childId = (await agent.listSessions({ includeSubagents: true })).find(
      (session) => session.sessionId !== parent.sessionId,
    )?.sessionId
    const childEvents = await readSession(env, childId ?? '')
    expect(childEvents).toContainEqual(
      expect.objectContaining({ type: 'turn.completed', reason: 'budget' }),
    )
    expect(env.fixtures.model.requests[1]?.tools.map((tool) => tool.name)).toEqual(['write'])
  })

  it('rejects recursive task delegation before creating a child session', async () => {
    const env = createDeterministicEnv([
      toolCall('task-1', 'task', {
        description: 'Try to recurse',
        prompt: 'Delegate this again.',
        allowed_tools: ['task'],
      }),
      text('The recursive request was rejected.'),
    ])
    const agent = Agent.open({ cwd: '/workspace', env })
    const parent = await agent.newSession({ permissionMode: 'auto' })

    await parent.turn('Try recursive delegation.')

    expect(await agent.listSessions()).toHaveLength(1)
    expect(await agent.listSessions({ includeSubagents: true })).toHaveLength(1)
    const events = await collectEvents(parent)
    expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
      ok: false,
      content: expect.stringContaining('cannot invoke the task tool recursively'),
    })
  })

  it('preserves the child allowlist when an internal session is resumed', async () => {
    const env = createDeterministicEnv([
      toolCall('task-1', 'task', {
        description: 'Inspect without recursion',
        prompt: 'Return a short result.',
      }),
      text('Child result.'),
      text('Parent result.'),
      toolCall('resumed-task-1', 'task', {
        description: 'Attempt recursion after resume',
        prompt: 'This must not create another child.',
      }),
      text('Resumed child continued safely.'),
    ])
    const agent = Agent.open({ cwd: '/workspace', env })
    const parent = await agent.newSession({ permissionMode: 'auto' })

    await parent.turn('Create a child.')
    const childId = (await agent.listSessions({ includeSubagents: true })).find(
      (session) => session.kind === 'subagent',
    )?.sessionId
    expect(childId).toBeDefined()

    const resumedChild = await agent.openSession(childId ?? '')
    const result = await resumedChild.turn('Continue the child session.')

    expect(result.terminal.type).toBe('turn.completed')
    expect(
      (await agent.listSessions({ includeSubagents: true })).filter(
        (session) => session.kind === 'subagent',
      ),
    ).toHaveLength(1)
    expect(env.fixtures.model.requests[3]?.tools.map((tool) => tool.name)).toEqual(['read'])
    const resumedEvents = await collectEvents(resumedChild)
    expect(resumedEvents.find((event) => event.type === 'tool.result')).toMatchObject({
      ok: false,
      content: expect.stringContaining('Unknown tool: task'),
    })
  })

  it('keeps explicit deny rules effective inside a mutation-capable child', async () => {
    const env = createDeterministicEnv(
      [
        toolCall('task-1', 'task', {
          description: 'Attempt a denied write',
          prompt: 'Try to create denied.txt, then report the outcome.',
          allowed_tools: ['write'],
        }),
        toolCall('child-write-1', 'write', { path: 'denied.txt', content: 'must not write' }),
        text('The write was denied by policy.'),
        text('Parent received the policy result.'),
      ],
      {
        permissionRules: [{ id: 'deny-child-write', tool: 'write', action: 'deny' }],
      },
    )
    const agent = Agent.open({ cwd: '/workspace', env })
    const parent = await agent.newSession({ permissionMode: 'auto' })

    await parent.turn('Delegate a write that policy must deny.')

    expect(env.fixtures.fs.exists('denied.txt')).toBe(false)
    const childId = (await agent.listSessions({ includeSubagents: true })).find(
      (session) => session.kind === 'subagent',
    )?.sessionId
    const childEvents = await readSession(env, childId ?? '')
    expect(childEvents).toContainEqual(
      expect.objectContaining({
        type: 'permission.evaluated',
        callId: 'child-write-1',
        decision: 'deny',
      }),
    )
  })

  it('inherits the parent turn reasoning effort', async () => {
    const env = createDeterministicEnv([
      toolCall('task-1', 'task', {
        description: 'Reason carefully',
        prompt: 'Return a considered answer.',
      }),
      text('Considered child result.'),
      text('Parent result.'),
    ])
    const agent = Agent.open({ cwd: '/workspace', env })
    const parent = await agent.newSession({ permissionMode: 'auto' })

    await parent.turn('Delegate with high reasoning.', { reasoningEffort: 'high' })

    expect(env.fixtures.model.requests[0]?.thinking).toEqual({
      type: 'enabled',
      budgetTokens: 32_768,
    })
    expect(env.fixtures.model.requests[1]?.thinking).toEqual({
      type: 'enabled',
      budgetTokens: 32_768,
    })
  })

  it('runs independent task calls from one model step concurrently', async () => {
    const probe = new ParallelTaskModel(2)
    const base = createDeterministicEnv([])
    const agent = Agent.open({ cwd: '/workspace', env: { ...base, llm: probe } })
    const parent = await agent.newSession({ permissionMode: 'auto' })

    const result = await parent.turn('Delegate two independent inspections.')

    expect(result.terminal.type).toBe('turn.completed')
    expect(probe.maxActiveChildren).toBe(2)
    expect(
      (await agent.listSessions({ includeSubagents: true })).filter(
        (session) => session.kind === 'subagent',
      ),
    ).toHaveLength(2)
  })

  it('caps concurrent child sessions at the SDK-configured limit', async () => {
    const probe = new ParallelTaskModel(3)
    const base = createDeterministicEnv([])
    const agent = Agent.open({
      cwd: '/workspace',
      env: { ...base, llm: probe },
      maxConcurrentSubagents: 1,
    })
    const parent = await agent.newSession({ permissionMode: 'auto' })

    await parent.turn('Delegate three inspections without exceeding the configured limit.')

    expect(probe.maxActiveChildren).toBe(1)
    expect(
      (await agent.listSessions({ includeSubagents: true })).filter(
        (session) => session.kind === 'subagent',
      ),
    ).toHaveLength(3)
  })

  it('serializes mutation-capable children that share the workspace', async () => {
    const probe = new ParallelTaskModel(2, ['write'])
    const base = createDeterministicEnv([])
    const agent = Agent.open({ cwd: '/workspace', env: { ...base, llm: probe } })
    const parent = await agent.newSession({ permissionMode: 'auto' })

    await parent.turn('Delegate two mutation-capable tasks safely.')

    expect(probe.maxActiveChildren).toBe(1)
  })

  it('rejects unsafe SDK subagent concurrency limits', () => {
    const env = createDeterministicEnv([])

    expect(() => Agent.open({ cwd: '/workspace', env, maxConcurrentSubagents: 0 })).toThrow(
      'maxConcurrentSubagents must be an integer from 1 to 32',
    )
    expect(() => Agent.open({ cwd: '/workspace', env, maxConcurrentSubagents: 33 })).toThrow(
      'maxConcurrentSubagents must be an integer from 1 to 32',
    )
  })

  it('propagates parent cancellation into the active child turn', async () => {
    const model = new CancellableTaskModel()
    const base = createDeterministicEnv([])
    const agent = Agent.open({ cwd: '/workspace', env: { ...base, llm: model } })
    const parent = await agent.newSession({ permissionMode: 'auto' })
    const controller = new AbortController()

    const running = parent.turn('Start a cancellable delegated task.', {
      signal: controller.signal,
    })
    await model.childStarted
    controller.abort('cancel delegated work')
    const result = await running

    expect(result.terminal.type).toBe('turn.cancelled')
    const child = (await agent.listSessions({ includeSubagents: true })).find(
      (session) => session.kind === 'subagent',
    )
    expect(child).toBeDefined()
    expect(await readSession(base, child?.sessionId ?? '')).toContainEqual(
      expect.objectContaining({ type: 'turn.cancelled' }),
    )
  })

  it('removes queued children when a concurrency-limited parent is cancelled', async () => {
    const model = new CancellableTaskModel(2)
    const base = createDeterministicEnv([])
    const agent = Agent.open({
      cwd: '/workspace',
      env: { ...base, llm: model },
      maxConcurrentSubagents: 1,
    })
    const parent = await agent.newSession({ permissionMode: 'auto' })
    const controller = new AbortController()

    const running = parent.turn('Start two delegated tasks with one available slot.', {
      signal: controller.signal,
    })
    await model.childStarted
    controller.abort('cancel queued delegated work')
    const result = await running

    expect(result.terminal.type).toBe('turn.cancelled')
    expect(
      (await agent.listSessions({ includeSubagents: true })).filter(
        (session) => session.kind === 'subagent',
      ),
    ).toHaveLength(1)
  })
})

async function readSession(env: ReturnType<typeof createDeterministicEnv>, sessionId: string) {
  const events = []
  for await (const event of env.store.read(sessionId)) events.push(event)
  return events
}

const TEST_USAGE = {
  type: 'usage',
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
} as const satisfies LlmDelta

class ParallelTaskModel implements LlmService {
  maxActiveChildren = 0
  #activeChildren = 0
  #parentSessionId: string | undefined
  #parentCalls = 0

  constructor(
    private readonly childCount: number,
    private readonly allowedTools?: readonly string[],
  ) {}

  async *stream(request: LlmRequest): AsyncIterable<LlmDelta> {
    this.#parentSessionId ??= request.metadata.sessionId
    if (request.metadata.sessionId === this.#parentSessionId) {
      this.#parentCalls += 1
      if (this.#parentCalls === 1) {
        const delegated = toolCalls(
          Array.from({ length: this.childCount }, (_, index) => ({
            callId: `task-${index + 1}`,
            name: 'task',
            args: {
              description: `Inspect ${index + 1}`,
              prompt: `Inspect area ${index + 1}.`,
              ...(this.allowedTools === undefined ? {} : { allowed_tools: this.allowedTools }),
            },
          })),
        )
        for (const call of delegated.message.toolCalls) {
          yield { type: 'tool_call', callId: call.callId, name: call.name, args: call.args }
        }
      } else {
        yield { type: 'text', text: 'Both delegated inspections completed.' }
      }
      yield TEST_USAGE
      yield { type: 'done' }
      return
    }

    this.#activeChildren += 1
    this.maxActiveChildren = Math.max(this.maxActiveChildren, this.#activeChildren)
    try {
      await new Promise((resolve) => setTimeout(resolve, 20))
      yield { type: 'text', text: `Child ${request.metadata.sessionId} completed.` }
      yield TEST_USAGE
      yield { type: 'done' }
    } finally {
      this.#activeChildren -= 1
    }
  }
}

class CancellableTaskModel implements LlmService {
  readonly childStarted: Promise<void>
  #resolveChildStarted!: () => void
  #parentSessionId: string | undefined
  #parentCalls = 0

  constructor(private readonly childCount = 1) {
    this.childStarted = new Promise((resolve) => {
      this.#resolveChildStarted = resolve
    })
  }

  async *stream(request: LlmRequest, context: LlmCallContext): AsyncIterable<LlmDelta> {
    this.#parentSessionId ??= request.metadata.sessionId
    if (request.metadata.sessionId === this.#parentSessionId && this.#parentCalls === 0) {
      this.#parentCalls += 1
      for (let index = 0; index < this.childCount; index += 1) {
        yield {
          type: 'tool_call',
          callId: `task-cancel-${index + 1}`,
          name: 'task',
          args: {
            description: `Wait for cancellation ${index + 1}`,
            prompt: 'Wait until cancelled.',
          },
        }
      }
      yield TEST_USAGE
      yield { type: 'done' }
      return
    }

    this.#resolveChildStarted()
    await waitForAbort(context.signal)
  }
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(new Error(String(signal.reason ?? 'aborted')))
  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(new Error(String(signal.reason ?? 'aborted')))
      },
      { once: true },
    )
  })
}
