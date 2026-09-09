import { describe, expect, it } from 'vitest'
import { createDeterministicEnv } from '../../src/env.js'
import { Agent } from '../../src/sdk/agent.js'
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js'
import { ToolExecutionError } from '../../src/tools/execution-error.js'
import { collectEvents } from '../helpers.js'

describe('tool settlement', () => {
  it('a late successful return after timeout is recorded as failure', async () => {
    const base = createDeterministicEnv([
      toolCall('read', 'read', { path: 'a.txt' }),
      text('timed out'),
    ])
    const env = {
      ...base,
      tools: {
        ...base.tools,
        registry: {
          list: () => base.tools.registry.list(),
          get: (name: string) => {
            const definition = base.tools.registry.get(name)
            return definition ? { ...definition, timeoutMs: 10 } : undefined
          },
        },
        executor: {
          async execute(_call: unknown, context: { signal: AbortSignal }) {
            await new Promise<void>((resolve) => {
              if (context.signal.aborted) resolve()
              else context.signal.addEventListener('abort', () => { resolve(); }, { once: true })
            })
            return { ok: true, content: 'partial diagnostic' }
          },
        },
      },
    }
    const session = await Agent.open({ cwd: '/workspace', env }).newSession()
    await session.turn('read')
    const events = await collectEvents(session)
    expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
      ok: false,
      content: expect.stringContaining('timeout after 10ms'),
    })
    expect(base.fixtures.model.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool_result',
      ok: false,
    })
  })

  it.each([false, true])('cancellation cannot become success; throwing=%s', async (throws) => {
    const base = createDeterministicEnv([toolCall('read', 'read', { path: 'a.txt' })])
    const controller = new AbortController()
    const env = {
      ...base,
      tools: {
        ...base.tools,
        executor: {
          async execute() {
            controller.abort()
            if (throws)
              throw new ToolExecutionError('interrupted', 'diagnostic before interruption')
            return { ok: true, content: 'late success' }
          },
        },
      },
    }
    const session = await Agent.open({ cwd: '/workspace', env }).newSession()
    const result = await session.turn('read', { signal: controller.signal })
    const events = await collectEvents(session)
    const tool = events.find((event) => event.type === 'tool.result')
    expect(result.terminal.type).toBe('turn.cancelled')
    expect(tool).toMatchObject({ ok: false, content: expect.stringContaining('aborted') })
    expect(tool?.type === 'tool.result' && tool.content).toContain(
      throws ? 'diagnostic before interruption' : 'late success',
    )
  })
})
