import { describe, expect, it } from 'vitest'
import { createAppliedPromptSummary } from './session-prompt-summary.js'

describe('createAppliedPromptSummary', () => {
  it('prefers estimated tokens when sections carry them', () => {
    expect(
      createAppliedPromptSummary([
        { charCount: 16_729, estimatedTokens: 5_200 },
        { charCount: 21_975, estimatedTokens: 6_600 },
      ]),
    ).toEqual({
      label: '本轮应用提示词',
      content: '本轮 Spark 实际应用提示词（System + Skill）：≈11,800 tokens（不含 SDK 内置预设）',
      charCount: 0,
      estimatedTokens: 0,
    })
  })

  it('falls back to char counts for legacy sections without token estimates', () => {
    expect(createAppliedPromptSummary([{ charCount: 1_200 }, { charCount: 340 }])).toEqual({
      label: '本轮应用提示词',
      content: '本轮 Spark 实际应用提示词（System + Skill）：1,540 字符（不含 SDK 内置预设）',
      charCount: 0,
    })
  })
})
