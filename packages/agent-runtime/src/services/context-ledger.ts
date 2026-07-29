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

  const sections = [
    makeSection('Skill Prompt', input.skillPrompt),
    makeSection('System Prompt', input.systemPrompt),
    makeSection('Project Context', input.projectContextPrompt, {
      ...(input.projectContextUsedTokens != null
        ? { estimatedTokens: input.projectContextUsedTokens }
        : {}),
      truncated: input.projectContextTruncated ?? false,
    }),
    makeSection(input.conversationHistoryLabel, input.conversationHistoryPrompt),
    makeSection('User Message', input.userMessage),
    makeSection('Attachments', input.attachmentPrompt),
  ].filter((section) => section.charCount > 0 || section.estimatedTokens > 0)

  return {
    sections,
    totalEstimatedTokens: sections.reduce((sum, section) => sum + section.estimatedTokens, 0),
  }
}
