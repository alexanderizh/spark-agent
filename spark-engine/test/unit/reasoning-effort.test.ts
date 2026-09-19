import { describe, expect, it } from 'vitest'

import { toOpenAiRequest } from '../../src/llm/openai/responses.js'
import { toAnthropicRequest } from '../../src/llm/anthropic/messages.js'
import {
  EFFORT_BUDGET_TOKENS,
  isReasoningEffort,
  thinkingConfigFor,
  type LlmRequest,
} from '../../src/llm/types.js'
import {
  helpDetail,
  helpLine,
  SLASH_COMMANDS,
  TUI_SHORTCUTS,
} from '../../src/tui/slash-commands.js'
import { DEFAULT_REASONING_EFFORT, EFFORT_OPTIONS } from '../../src/tui/components/effort-picker.js'
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
    expect(thinkingConfigFor('high', 0)).toEqual({
      type: 'enabled',
      budgetTokens: EFFORT_BUDGET_TOKENS.high,
    })
    expect(thinkingConfigFor('high', 8_192)).toEqual({
      type: 'enabled',
      budgetTokens: 8_192,
    })
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
    // Thinking and visible output share the ceiling. Keep a visible answer
    // reserve instead of spending the entire request on hidden reasoning.
    const clampedWithoutTools = toAnthropicRequest(
      { ...baseRequest(), thinking: thinkingConfigFor('max') },
      'claude-test',
      true,
    )
    expect(clampedWithoutTools.thinking).toEqual({ type: 'enabled', budget_tokens: 6_144 })
    const clampedWithTools = toAnthropicRequest(
      {
        ...baseRequest(),
        tools: [{ name: 'write', description: 'Write a file', inputSchema: { type: 'object' } }],
        thinking: thinkingConfigFor('max'),
      },
      'claude-test',
      true,
    )
    expect(clampedWithTools.thinking).toEqual({ type: 'enabled', budget_tokens: 5_462 })
    const tooSmallForThinking = toAnthropicRequest(
      { ...baseRequest(), maxTokens: 512, thinking: thinkingConfigFor('high') },
      'claude-test',
      true,
    )
    expect(tooSmallForThinking.thinking).toEqual({ type: 'disabled' })
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

  it('lays the /help detail out as one aligned entry per line', () => {
    const lines = helpDetail().split('\n')
    // Two titles + one row per entry + a blank line between the two sections.
    expect(lines).toHaveLength(2 + SLASH_COMMANDS.length + TUI_SHORTCUTS.length + 1)
    expect(lines).not.toContainEqual(expect.stringContaining(' · '))
    expect(lines).toContain('命令：')
    expect(lines).toContain('快捷键：')

    // Every entry owns its line, and the summary column starts at one offset.
    const columns = [
      ...SLASH_COMMANDS.map((command) => ({ label: command.name, summary: command.summary })),
      ...TUI_SHORTCUTS.map((shortcut) => ({ label: shortcut.keys, summary: shortcut.summary })),
    ].map((entry) => {
      const row = lines.find((line) => line.trimStart().startsWith(`${entry.label} `))
      expect(row, `missing /help row for ${entry.label}`).toBeDefined()
      return (row ?? '').indexOf(entry.summary)
    })
    expect(columns).not.toContain(-1)
    expect(new Set(columns).size).toBe(1)
  })

  it('appends custom commands as their own aligned /help section', () => {
    const detail = helpDetail([{ label: '/review', summary: '审阅当前改动' }])
    const lines = detail.split('\n')
    expect(lines).toContain('自定义命令：')
    expect(detail.split('\n\n')).toHaveLength(3)

    const column = lines.find((line) => line.includes('中断任务'))?.indexOf('中断任务')
    const customRow = lines.find((line) => line.trimStart().startsWith('/review '))
    expect(customRow, 'missing custom command row').toBeDefined()
    // Custom entries reuse the builtin label column so /help stays one grid.
    expect((customRow ?? '').indexOf('审阅当前改动')).toBe(column)
  })

  it('exposes the effort picker levels as the /effort option set', () => {
    const labels = EFFORT_OPTIONS.map((option) => option.label)
    expect(labels).toEqual(['low', 'medium', 'high', 'max', 'off'])
    expect(EFFORT_OPTIONS.map((option) => option.value)).not.toContain(undefined)
    expect(DEFAULT_REASONING_EFFORT).toBe('high')
  })

  it('keeps one-key permission cycling inside non-destructive modes only', () => {
    expect(nextPermissionMode('manual')).toBe('auto')
    expect(nextPermissionMode('auto')).toBe('manual')
    // Bypass can never be reached with a single keypress.
    expect(nextPermissionMode('bypass')).toBe('manual')
  })
})
