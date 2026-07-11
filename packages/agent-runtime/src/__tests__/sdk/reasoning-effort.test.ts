import { describe, expect, it } from 'vitest'
import {
  normalizeSparkReasoningEffort,
  toClaudeReasoningEffort,
  toCodexReasoningEffort,
  toOpenAIResponsesReasoningEffort,
  type SparkReasoningEffort,
} from '../../sdk/reasoning-effort.js'

const sparkEfforts: SparkReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

describe('reasoning effort mapping', () => {
  it('normalizes every Spark effort without collapsing supported values', () => {
    for (const effort of sparkEfforts) {
      expect(normalizeSparkReasoningEffort(effort)).toBe(effort)
    }
    expect(normalizeSparkReasoningEffort('unknown')).toBe('max')
  })

  it('maps Spark effort to Claude native levels', () => {
    expect(toClaudeReasoningEffort('minimal')).toBe('low')
    expect(toClaudeReasoningEffort('low')).toBe('low')
    expect(toClaudeReasoningEffort('medium')).toBe('medium')
    expect(toClaudeReasoningEffort('high')).toBe('high')
    expect(toClaudeReasoningEffort('xhigh')).toBe('xhigh')
    expect(toClaudeReasoningEffort('max')).toBe('max')
  })

  it('maps Spark effort to Codex native levels', () => {
    expect(toCodexReasoningEffort('minimal')).toBe('low')
    expect(toCodexReasoningEffort('low')).toBe('low')
    expect(toCodexReasoningEffort('medium')).toBe('medium')
    expect(toCodexReasoningEffort('high')).toBe('high')
    expect(toCodexReasoningEffort('xhigh')).toBe('xhigh')
    expect(toCodexReasoningEffort('max')).toBe('xhigh')
  })

  it('maps Spark effort to OpenAI Responses levels with only max degraded', () => {
    expect(toOpenAIResponsesReasoningEffort('minimal')).toBe('minimal')
    expect(toOpenAIResponsesReasoningEffort('low')).toBe('low')
    expect(toOpenAIResponsesReasoningEffort('medium')).toBe('medium')
    expect(toOpenAIResponsesReasoningEffort('high')).toBe('high')
    expect(toOpenAIResponsesReasoningEffort('xhigh')).toBe('xhigh')
    expect(toOpenAIResponsesReasoningEffort('max')).toBe('xhigh')
  })
})
