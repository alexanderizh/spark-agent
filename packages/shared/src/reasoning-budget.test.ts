import { describe, expect, it } from 'vitest'
import {
  MAX_REASONING_BUDGET_TOKENS,
  MIN_REASONING_BUDGET_TOKENS,
  normalizeReasoningBudgetTokens,
} from './reasoning-budget.js'

describe('normalizeReasoningBudgetTokens', () => {
  it('accepts bounded integer numbers and numeric form values', () => {
    expect(normalizeReasoningBudgetTokens(MIN_REASONING_BUDGET_TOKENS)).toBe(1_024)
    expect(normalizeReasoningBudgetTokens('8192')).toBe(8_192)
    expect(normalizeReasoningBudgetTokens(MAX_REASONING_BUDGET_TOKENS)).toBe(128_000)
  })

  it('rejects empty, fractional, non-finite and out-of-range values', () => {
    for (const value of [undefined, null, '', 1_023, 1_024.5, Number.POSITIVE_INFINITY, 128_001]) {
      expect(normalizeReasoningBudgetTokens(value)).toBeUndefined()
    }
  })
})
