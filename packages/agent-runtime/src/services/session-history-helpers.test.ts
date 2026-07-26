import { describe, expect, it } from 'vitest'
import { estimateTokens } from '@spark/shared'
import {
  computeHistoryEntryTokenBudget,
  computeHistoryTokenBudget,
  formatDialogueEntriesWithinTokenBudget,
} from './session-history-helpers.js'

describe('session-history-helpers', () => {
  it('derives history budgets from the actual context window', () => {
    expect(computeHistoryTokenBudget(128_000)).toBe(38_400)
    expect(computeHistoryTokenBudget(200_000)).toBe(60_000)
    expect(computeHistoryTokenBudget(1_000_000)).toBe(100_000)
    expect(computeHistoryTokenBudget(Number.NaN)).toBe(8_000)

    expect(computeHistoryEntryTokenBudget(200_000)).toBe(1_500)
    expect(computeHistoryEntryTokenBudget(1_000_000)).toBe(4_000)
    expect(computeHistoryEntryTokenBudget(32_000)).toBe(1_000)
  })

  it('clips each entry before applying the total history budget', () => {
    const transcript = formatDialogueEntriesWithinTokenBudget(
      [{ role: 'User', content: `START-${'x'.repeat(100_000)}-END` }],
      { historyTokenBudget: 1_000, entryTokenBudget: 200 },
    )

    expect(transcript).toContain('START-')
    expect(transcript).toContain('-END')
    expect(estimateTokens(transcript)).toBeLessThanOrEqual(1_000)
  }, 15_000)

  it('keeps a contiguous latest window inside the strict total budget', () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      role: (index % 2 === 0 ? 'User' : 'Assistant') as 'User' | 'Assistant',
      content: `entry-${index} ${'detail '.repeat(80)}`,
    }))
    const transcript = formatDialogueEntriesWithinTokenBudget(entries, {
      historyTokenBudget: 300,
      entryTokenBudget: 100,
    })

    expect(transcript).toContain('entry-19')
    expect(transcript).not.toContain('entry-0')
    expect(estimateTokens(transcript)).toBeLessThanOrEqual(300)
  })
})
