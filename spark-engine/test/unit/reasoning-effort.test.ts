import { describe, expect, it } from 'vitest'

import { toOpenAiRequest } from '../../src/llm/openai/responses.js'
import { toAnthropicRequest } from '../../src/llm/anthropic/messages.js'
import {
  EFFORT_BUDGET_TOKENS,
  isReasoningEffort,
  thinkingConfigFor,
  type LlmRequest,
} from '../../src/llm/types.js'
import { cycleEffort, effortLabel, helpLine, SLASH_COMMANDS } from '../../src/tui/slash-commands.js'
import { nextPermissionMode } from '../../src/tui/components/permission-picker.js'

function baseRequest(): LlmRequest {
  return {
    system: [{ id: 'base', content: 'You are Spark.', stability: 'stable' }],
    messages: [{ role: 'user', content: 'Plan the work', sourceSeqs: [0] }],
    tools: [],
    maxTokens: 8_192,
    metadata: {},
  }
}

describe('reasoning effort mapping', () => {
  it('maps every level onto a provider-neutral thinking config', () => {
    expect(thinkingConfigFor('off')).toEqual({ type: 'disabled' })
    for (const level of ['low', 'medium', 'high'] as const) {
      expect(thinkingConfigFor(level)).toEqual({
        type: 'enabled',
        budgetTokens: EFFORT_BUDGET_TOKENS[level],
      })
    }
  })

  it('validates CLI-provided levels strictly', () => {
    for (const level of ['off', 'low', 'medium', 'high']) {
      expect(isReasoningEffort(level)).toBe(true)
    }
    for (const invalid of ['', 'OFF', 'auto', 'maximum', 'high ']) {
      expect(isReasoningEffort(invalid)).toBe(false)
    }
  })

  it('translates budgets into OpenAI reasoning.effort buckets', () => {
    const build = (level: 'low' | 'medium' | 'high') =>
      toOpenAiRequest({ ...baseRequest(), thinking: thinkingConfigFor(level) }, 'gpt-test')
    expect(build('low')).toMatchObject({ reasoning: { effort: 'low' } })
    expect(build('medium')).toMatchObject({ reasoning: { effort: 'medium' } })
    expect(build('high')).toMatchObject({ reasoning: { effort: 'high' } })
    // An explicit adaptive hint passes straight through.
    const adaptive = toOpenAiRequest(
      { ...baseRequest(), thinking: { type: 'adaptive', effort: 'medium' } },
      'gpt-test',
    )
    expect(adaptive).toMatchObject({ reasoning: { effort: 'medium' } })
  })

  it('keeps reasoning out of the request when effort is off or unset', () => {
    for (const request of [
      baseRequest(),
      { ...baseRequest(), thinking: thinkingConfigFor('off') },
    ]) {
      expect(toOpenAiRequest(request, 'gpt-test').reasoning).toBeUndefined()
    }
  })

  it('lands enabled-thinking budgets as Anthropic budget_tokens and disables cleanly', () => {
    const high = toAnthropicRequest(
      { ...baseRequest(), thinking: thinkingConfigFor('high') },
      'claude-test',
      true,
    )
    expect(high.thinking).toEqual({ type: 'enabled', budget_tokens: EFFORT_BUDGET_TOKENS.high })
    const off = toAnthropicRequest(
      { ...baseRequest(), thinking: thinkingConfigFor('off') },
      'claude-test',
      true,
    )
    expect(off.thinking).toEqual({ type: 'disabled' })
  })
})

describe('slash command surface', () => {
  it('covers the model/perms/effort/clear/help/status/exit set once each', () => {
    const names = SLASH_COMMANDS.map((command) => command.name)
    expect(new Set(names).size).toBe(names.length)
    for (const required of ['/help', '/status', '/model', '/perm', '/effort', '/clear', '/exit']) {
      expect(names).toContain(required)
    }
    expect(helpLine()).toContain('/effort')
  })

  it('cycles effort auto → off → low → medium → high → auto', () => {
    let current: ReturnType<typeof cycleEffort> = undefined
    const seen: string[] = []
    for (let index = 0; index < 5; index += 1) {
      current = cycleEffort(current)
      seen.push(effortLabel(current))
    }
    expect(seen).toEqual(['off', 'low', 'medium', 'high', 'auto'])
    expect(effortLabel(undefined)).toBe('auto')
  })

  it('keeps one-key permission cycling inside non-destructive modes only', () => {
    expect(nextPermissionMode('default')).toBe('acceptEdits')
    expect(nextPermissionMode('acceptEdits')).toBe('plan')
    expect(nextPermissionMode('plan')).toBe('default')
    // Bypass can never be reached with a single keypress.
    expect(nextPermissionMode('bypass')).toBe('default')
  })
})
