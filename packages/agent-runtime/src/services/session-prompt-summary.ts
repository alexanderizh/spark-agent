export interface PromptSectionSnapshot {
  label: string
  content: string
  charCount: number
  estimatedTokens?: number
}

/** Summarize the Spark-authored prompt sections that were actually applied. */
export function createAppliedPromptSummary(
  sections: readonly Pick<PromptSectionSnapshot, 'charCount' | 'estimatedTokens'>[],
): PromptSectionSnapshot {
  const appliedPromptChars = sections.reduce((sum, section) => sum + section.charCount, 0)
  const appliedPromptTokens = sections.reduce(
    (sum, section) => sum + (section.estimatedTokens ?? 0),
    0,
  )
  return {
    label: '本轮应用提示词',
    // token 口径优先展示（字符数视觉上偏大，容易误导体积判断）；
    // 仅当所有段落都缺 estimatedTokens（旧数据）时回退字符数文案。
    content:
      appliedPromptTokens > 0
        ? `本轮 Spark 实际应用提示词（System + Skill）：≈${appliedPromptTokens.toLocaleString('zh-CN')} tokens（不含 SDK 内置预设）`
        : `本轮 Spark 实际应用提示词（System + Skill）：${appliedPromptChars.toLocaleString('zh-CN')} 字符（不含 SDK 内置预设）`,
    charCount: 0,
    ...(appliedPromptTokens > 0 ? { estimatedTokens: 0 } : {}),
  }
}
