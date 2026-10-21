export interface PromptSectionSnapshot {
  label: string
  content: string
  charCount: number
}

/** Summarize the Spark-authored prompt sections that were actually applied. */
export function createAppliedPromptSummary(
  sections: readonly Pick<PromptSectionSnapshot, 'charCount'>[],
): PromptSectionSnapshot {
  const appliedPromptChars = sections.reduce((sum, section) => sum + section.charCount, 0)
  return {
    label: '本轮应用提示词',
    content: `本轮 Spark 实际应用提示词（System + Skill）：${appliedPromptChars.toLocaleString('zh-CN')} 字符（不含 SDK 内置预设）`,
    charCount: 0,
  }
}
