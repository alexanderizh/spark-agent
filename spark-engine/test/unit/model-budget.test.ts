import { describe, expect, it } from 'vitest'

import { createDeterministicEnv } from '../../src/env.js'
import { text } from '../../src/llm/fake/reply-dsl.js'
import { resolveOutputBudget } from '../../src/llm/budget.js'
import { ModelRegistry } from '../../src/llm/registry.js'
import { ResilientLlmService } from '../../src/llm/resilience.js'
import type { LlmRequest, ModelBudget } from '../../src/llm/types.js'
import { Agent } from '../../src/sdk/agent.js'

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    system: [{ id: 'system', content: 'You are Spark.', stability: 'stable' }],
    messages: [{ role: 'user', content: 'Answer.', sourceSeqs: [0] }],
    tools: [],
    maxTokens: 16_384,
    metadata: {},
    ...overrides,
  }
}

describe('model-aware output budgets', () => {
  it('prefers the SparkWork model ceiling over the SDK fallback', async () => {
    const env = createDeterministicEnv([text('done')])
    const budget: ModelBudget = { contextWindowTokens: 32_000, maxOutputTokens: 4_096 }
    const base = env.fixtures.model
    const budgetedEnv = {
      ...env,
      llm: {
        getModelBudget: () => budget,
        stream: (input: LlmRequest, context: Parameters<typeof base.stream>[1]) =>
          base.stream(input, context),
      },
    }
    const session = await Agent.open({ cwd: '/workspace', env: budgetedEnv }).newSession()

    await session.turn('answer')

    expect(base.requests[0]?.maxTokens).toBe(4_096)
  })

  it('never lets an explicit per-turn limit exceed the model limit', () => {
    const resolved = resolveOutputBudget({
      requestedMaxTokens: 12_000,
      modelBudget: { maxOutputTokens: 4_096 },
      ...request(),
    })
    expect(resolved.maxTokens).toBe(4_096)
    expect(resolved.source).toBe('model')

    const smaller = resolveOutputBudget({
      requestedMaxTokens: 1_024,
      modelBudget: { maxOutputTokens: 4_096 },
      ...request(),
    })
    expect(smaller.maxTokens).toBe(1_024)
    expect(smaller.source).toBe('request')
  })

  it('caps generation by the remaining advertised context window', () => {
    const resolved = resolveOutputBudget({
      modelBudget: { contextWindowTokens: 2_000, maxOutputTokens: 10_000 },
      system: [{ id: 'system', content: 'a'.repeat(3_000), stability: 'stable' }],
      messages: [],
      tools: [],
    })
    expect(resolved.contextWindowTokens).toBe(2_000)
    expect(resolved.remainingContextTokens).toBeLessThan(2_000)
    expect(resolved.maxTokens).toBeLessThan(1_500)
    expect(resolved.limitedByContext).toBe(true)
  })

  it('fails before the provider call when the context is exhausted', () => {
    try {
      resolveOutputBudget({
        modelBudget: { contextWindowTokens: 512, maxOutputTokens: 4_096 },
        system: [{ id: 'system', content: 'a'.repeat(10_000), stability: 'stable' }],
        messages: [],
        tools: [],
      })
      throw new Error('expected context exhaustion')
    } catch (error) {
      expect(error).toMatchObject({ code: 'llm.context_window_exhausted' })
    }
  })

  it('publishes registered route budget to the SDK resolver', () => {
    const registry = new ModelRegistry()
    registry.registerHttp({
      id: 'route',
      providerId: 'provider',
      protocol: 'openai-responses',
      model: 'model',
      apiKey: 'secret',
      contextWindowTokens: 128_000,
      maxOutputTokens: 32_000,
    })

    expect(registry.createRoute(['route']).getModelBudget?.()).toEqual({
      contextWindowTokens: 128_000,
      maxOutputTokens: 32_000,
    })
  })

  it('re-clamps a failover request to the fallback route ceiling', async () => {
    const seen: number[] = []
    const fallback = {
      getModelBudget: () => ({ maxOutputTokens: 1_024 }),
      stream: async function* (input: LlmRequest) {
        seen.push(input.maxTokens)
        yield { type: 'text', text: 'fallback' } as const
        yield { type: 'done' } as const
      },
    }
    const service = new ResilientLlmService({
      routes: [{ id: 'fallback', service: fallback }],
    })

    for await (const delta of service.stream(request({ maxTokens: 8_192 }), {
      signal: new AbortController().signal,
      turnId: 'turn-1',
      stepId: 'step-1',
    })) {
      expect(delta).toBeDefined()
    }

    expect(seen).toEqual([1_024])
  })
})
