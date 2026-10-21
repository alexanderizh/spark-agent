import { describe, expect, it } from 'vitest'
import { createAppliedPromptSummary } from './session-prompt-summary.js'

describe('createAppliedPromptSummary', () => {
  it('counts only the Spark prompt sections included in the snapshot', () => {
    expect(createAppliedPromptSummary([{ charCount: 1_200 }, { charCount: 340 }])).toEqual({
      label: '本轮应用提示词',
      content: '本轮 Spark 实际应用提示词（System + Skill）：1,540 字符（不含 SDK 内置预设）',
      charCount: 0,
    })
  })
})
