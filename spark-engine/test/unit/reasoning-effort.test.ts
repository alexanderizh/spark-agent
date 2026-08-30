import { describe, expect, it } from 'vitest'

import { toOpenAiRequest } from '../../src/llm/openai/responses.js'
import { toAnthropicRequest } from '../../src/llm/anthropic/messages.js'
import {
  EFFORT_BUDGET_TOKENS,
  isReasoningEffort,
  thinkingConfigFor,
  type LlmRequest,
} from '../../src/llm/types.js'
import { helpDetail, helpLine, SLASH_COMMANDS, TUI_SHORTCUTS } from '../../src/tui/slash-commands.js'
import { EFFORT_OPTIONS } from '../../src/tui/components/effort-picker.js'
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
    for (const level of ['low', 'medium', 'high', 'max'] as const) {
      expect(thinkingConfigFor(level)).toEqual({
        type: 'enabled',
        budgetTokens: EFFORT_BUDGET_TOKENS[level],
      })
    }
    expect(EFFORT_BUDGET_TOKENS.max).toBeGreaterThan(EFFORT_BUDGET_TOKENS.high)
  })

  it('validates CLI-provided levels strictly', () => {
    for (const level of ['off', 'low', 'medium', 'high', 'max']) {
      expect(isReasoningEffort(level)).toBe(true)
    }
    for (const invalid of ['', 'OFF', 'auto', 'maximum', 'high ', 'xhigh']) {
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

  it('lands enabled-thinking budgets as Anthropic budget_tokens and clamps to max_tokens', () => {
    const roomy = { ...baseRequest(), maxTokens: 8_192 * 16 }
    const high = toAnthropicRequest(
      { ...roomy, thinking: thinkingConfigFor('high') },
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
    // Any effort level — including max — must stay below the request's own
    // output ceiling or the API rejects the request outright.
    const clamped = toAnthropicRequest(
      { ...baseRequest(), thinking: thinkingConfigFor('max') },
      'claude-test',
      true,
    )
    expect(clamped.thinking).toEqual({ type: 'enabled', budget_tokens: 8_192 - 1 })
  })

  it('coarsens the max budget onto the OpenAI high effort bucket', () => {
    const maximum = toOpenAiRequest(
      { ...baseRequest(), thinking: thinkingConfigFor('max') },
      'gpt-test',
    )
    expect(maximum.reasoning).toEqual({ effort: 'high' })
  })
})

describe('slash command surface', () => {
  it('covers the model/perms/effort/update/clear/help/status/exit set once each', () => {
    const names = SLASH_COMMANDS.map((command) => command.name)
    expect(new Set(names).size).toBe(names.length)
    for (const required of [
      '/help',
      '/status',
      '/model',
      '/perm',
      '/effort',
      '/update',
      '/clear',
      '/exit',
    ]) {
      expect(names).toContain(required)
    }
    expect(helpLine()).toContain('/effort')
  })

  it('lists every command and shortcut in the /help detail', () => {
    const detail = helpDetail()
    for (const command of SLASH_COMMANDS) {
      expect(detail).toContain(command.name)
      expect(detail).toContain(command.summary)
    }
    for (const shortcut of TUI_SHORTCUTS) {
      expect(detail).toContain(shortcut.keys)
      expect(detail).toContain(shortcut.summary)
    }
  })

  it('exposes the effort picker levels as the /effort option set', () => {
    const labels = EFFORT_OPTIONS.map((option) => option.label)
    expect(labels).toEqual(['auto', 'low', 'medium', 'high', 'max', 'off'])
    expect(EFFORT_OPTIONS[0]?.value).toBeUndefined()
  })

  it('keeps one-key permission cycling inside non-destructive modes only', () => {
    expect(nextPermissionMode('default')).toBe('acceptEdits')
    expect(nextPermissionMode('acceptEdits')).toBe('plan')
    expect(nextPermissionMode('plan')).toBe('default')
    // Bypass can never be reached with a single keypress.
    expect(nextPermissionMode('bypass')).toBe('default')
  })
})
