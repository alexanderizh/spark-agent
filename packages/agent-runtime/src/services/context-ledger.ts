import type { ContextLedgerEntry } from '@spark/protocol'
import { estimateTokens } from '@spark/shared'

export interface BuildContextLedgerInput {
  skillPrompt?: string | undefined
  /** System-only instructions. Must exclude project context and conversation history. */
  systemPrompt?: string | undefined
  projectContextPrompt?: string | undefined
  projectContextUsedTokens?: number | undefined
  projectContextTruncated?: boolean | undefined
  conversationHistoryLabel: string
  conversationHistoryPrompt?: string | undefined
  /**
   * 原生 resume 路径：conversationHistoryPrompt 为空（历史由 runtime 内部维护），
   * 传上一轮最后一次真实请求的 prompt 规模（含当轮静态段与历史），用于反推
   * 展示用的历史段 = max(0, 该值 − 本轮静态段合计)。conversationHistoryPrompt
   * 非空（fresh 路径）时忽略本字段。
   */
  conversationHistoryUsedTokens?: number | undefined
  userMessage: string
  attachmentPrompt?: string | undefined
}

export interface ContextLedgerResult {
  sections: ContextLedgerEntry[]
  totalEstimatedTokens: number
}

/**
 * Build mutually exclusive context-ledger sections.
 *
 * The caller must pass a system-only prompt so project context and conversation
 * history remain visible as their own sections without being counted twice.
 */
export function buildContextLedger(input: BuildContextLedgerInput): ContextLedgerResult {
  const makeSection = (
    label: string,
    content: string | undefined,
    options: { estimatedTokens?: number; truncated?: boolean } = {},
  ): ContextLedgerEntry => {
    const normalized = content?.trim() ?? ''
    return {
      label,
      estimatedTokens: options.estimatedTokens ?? estimateTokens(normalized),
      charCount: normalized.length,
      truncated: options.truncated ?? false,
    }
  }

  const staticSections = [
    makeSection('Skill Prompt', input.skillPrompt),
    makeSection('System Prompt', input.systemPrompt),
    makeSection('Project Context', input.projectContextPrompt, {
      ...(input.projectContextUsedTokens != null
        ? { estimatedTokens: input.projectContextUsedTokens }
        : {}),
      truncated: input.projectContextTruncated ?? false,
    }),
  ].filter((section) => section.charCount > 0 || section.estimatedTokens > 0)
  const trailingSections = [
    makeSection('User Message', input.userMessage),
    makeSection('Attachments', input.attachmentPrompt),
  ].filter((section) => section.charCount > 0 || section.estimatedTokens > 0)

  // 历史段单独处理：fresh 路径按注入的 prompt 文本估算；原生 resume 路径 prompt
  // 为空（历史由 runtime 维护、不进 Spark prompt），若直接省略该段，账本总量会
  // 恒等于静态 prompt 规模，「上下文用量」随之冻结——改用上一轮真实 prompt 规模
  // 反推展示值，让账本继续随会话增长。
  const historyPromptNormalized = input.conversationHistoryPrompt?.trim() ?? ''
  const staticTotal = [...staticSections, ...trailingSections].reduce(
    (sum, section) => sum + section.estimatedTokens,
    0,
  )
  const historySection =
    historyPromptNormalized.length > 0
      ? makeSection(input.conversationHistoryLabel, input.conversationHistoryPrompt)
      : input.conversationHistoryUsedTokens != null
        ? // prevReal ≈ prevStatic + prevHistory，静态段跨轮基本稳定 →
          // history ≈ prevReal − 本轮静态段合计；相减为 0 时按空段过滤。
          makeSection(input.conversationHistoryLabel, undefined, {
            estimatedTokens: Math.max(0, input.conversationHistoryUsedTokens - staticTotal),
          })
        : null
  const historySections =
    historySection != null && (historySection.charCount > 0 || historySection.estimatedTokens > 0)
      ? [historySection]
      : []

  const sections = [...staticSections, ...historySections, ...trailingSections]

  return {
    sections,
    totalEstimatedTokens: sections.reduce((sum, section) => sum + section.estimatedTokens, 0),
  }
}
