import { describe, expect, it } from 'vitest'

import type { LlmCallContext, LlmService } from '../../src/seams.js'
import type { LlmDelta, LlmRequest } from '../../src/llm/types.js'
import { SwitchableLlmService, UnconfiguredModelError } from '../../src/llm/switchable.js'

describe('SwitchableLlmService', () => {
  it('streams through the current service and can be swapped between turns', async () => {
    const switchable = new SwitchableLlmService()
    switchable.set(fakeModel('first'))
    expect(await drain(switchable)).toEqual([{ type: 'text', text: 'first' }])

    switchable.set(fakeModel('second'))
    expect(await drain(switchable)).toEqual([{ type: 'text', text: 'second' }])

    switchable.clear()
    await expect(drain(switchable)).rejects.toThrow(UnconfiguredModelError)
  })

  it('refuses to swap while a turn is in flight so turns keep their route', async () => {
    const switchable = new SwitchableLlmService()
    switchable.set(
      new (class implements LlmService {
        async *stream(): AsyncIterable<LlmDelta> {
          yield { type: 'text', text: 'before' }
          yield { type: 'text', text: 'after' }
        }
      })(),
    )
    const iterator = switchable.stream(request(), context())[Symbol.asyncIterator]()
    const first = await iterator.next()
    expect(first.done).toBe(false)
    expect(() => {
      switchable.set(fakeModel('intruder'))
    }).toThrow(/in flight/u)
    expect(() => {
      switchable.clear()
    }).toThrow(/in flight/u)
    const second = await iterator.next()
    expect(second.done).toBe(false)
    await iterator.return?.()
  })
})

function fakeModel(text: string): LlmService {
  return {
    async *stream(): AsyncIterable<LlmDelta> {
      yield { type: 'text', text }
    },
  }
}

async function drain(service: LlmService): Promise<LlmDelta[]> {
  const deltas: LlmDelta[] = []
  for await (const delta of service.stream(request(), context())) deltas.push(delta)
  return deltas
}

function request(): LlmRequest {
  return {
    system: [],
    messages: [],
    tools: [],
    maxTokens: 128,
    metadata: {},
  }
}

function context(): LlmCallContext {
  return { signal: AbortSignal.timeout(1_000), turnId: 'turn-1', stepId: 'step-1' }
}
