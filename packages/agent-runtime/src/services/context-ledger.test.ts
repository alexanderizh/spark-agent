import { describe, expect, it } from 'vitest'
import { estimateTokens } from '@spark/shared'
import { buildContextLedger } from './context-ledger.js'

describe('buildContextLedger', () => {
  it('keeps system, project context, and conversation history mutually exclusive', () => {
    const skillPrompt = 'skill instructions'
    const systemPrompt = 'system-only instructions'
    const projectContextPrompt = 'project context'
    const conversationHistoryPrompt = 'conversation history'
    const userMessage = 'current user message'

    const result = buildContextLedger({
      skillPrompt,
      systemPrompt,
      projectContextPrompt,
      projectContextUsedTokens: 37,
      conversationHistoryLabel: 'Conversation History',
      conversationHistoryPrompt,
      userMessage,
    })

    expect(result.sections).toEqual([
      {
        label: 'Skill Prompt',
        estimatedTokens: estimateTokens(skillPrompt),
        charCount: skillPrompt.length,
        truncated: false,
      },
      {
        label: 'System Prompt',
        estimatedTokens: estimateTokens(systemPrompt),
        charCount: systemPrompt.length,
        truncated: false,
      },
      {
        label: 'Project Context',
        estimatedTokens: 37,
        charCount: projectContextPrompt.length,
        truncated: false,
      },
      {
        label: 'Conversation History',
        estimatedTokens: estimateTokens(conversationHistoryPrompt),
        charCount: conversationHistoryPrompt.length,
        truncated: false,
      },
      {
        label: 'User Message',
        estimatedTokens: estimateTokens(userMessage),
        charCount: userMessage.length,
        truncated: false,
      },
    ])
    expect(result.totalEstimatedTokens).toBe(
      estimateTokens(skillPrompt) +
        estimateTokens(systemPrompt) +
        37 +
        estimateTokens(conversationHistoryPrompt) +
        estimateTokens(userMessage),
    )
  })

  it('filters empty sections and preserves project-context truncation metadata', () => {
    const result = buildContextLedger({
      systemPrompt: '  base prompt  ',
      projectContextPrompt: '  project  ',
      projectContextTruncated: true,
      conversationHistoryLabel: 'Conversation History',
      userMessage: '   ',
      attachmentPrompt: '',
    })

    expect(result.sections.map((section) => section.label)).toEqual([
      'System Prompt',
      'Project Context',
    ])
    expect(result.sections[0]?.charCount).toBe('base prompt'.length)
    expect(result.sections[1]).toMatchObject({
      estimatedTokens: estimateTokens('project'),
      charCount: 'project'.length,
      truncated: true,
    })
  })
})
