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

  it('derives the deferred runtime history section from the last real prompt size', () => {
    // 原生 resume 实况：conversationHistoryPrompt 为空（历史由 runtime 维护），
    // 上一轮真实 prompt 规模 300K，静态段（system+project+user）合计约 20K。
    const result = buildContextLedger({
      systemPrompt: 'system-only instructions',
      projectContextPrompt: 'project context',
      conversationHistoryLabel: 'Conversation History (native resume)',
      conversationHistoryUsedTokens: 300_000,
      userMessage: 'current user message',
    })

    const staticTotal =
      estimateTokens('system-only instructions') +
      estimateTokens('project context') +
      estimateTokens('current user message')
    const history = result.sections.find(
      (section) => section.label === 'Conversation History (native resume)',
    )
    expect(history).toMatchObject({
      estimatedTokens: 300_000 - staticTotal,
      charCount: 0,
    })
    // 账本总量随真实规模增长，不再冻结在静态段合计
    expect(result.totalEstimatedTokens).toBe(300_000)
  })

  it('drops the deferred history section when no real usage exists yet', () => {
    const result = buildContextLedger({
      systemPrompt: 'base prompt',
      conversationHistoryLabel: 'Conversation History (native resume)',
      userMessage: 'hello',
    })

    expect(result.sections.map((section) => section.label)).toEqual([
      'System Prompt',
      'User Message',
    ])
  })

  it('drops the deferred history section when real usage does not exceed static sections', () => {
    const result = buildContextLedger({
      systemPrompt: 'system-only instructions',
      conversationHistoryLabel: 'Conversation History (native resume)',
      conversationHistoryUsedTokens: 2,
      userMessage: 'current user message',
    })

    expect(result.sections.map((section) => section.label)).toEqual([
      'System Prompt',
      'User Message',
    ])
    expect(result.totalEstimatedTokens).toBe(
      estimateTokens('system-only instructions') + estimateTokens('current user message'),
    )
  })

  it('prefers the injected history prompt over the derived value on fresh paths', () => {
    const result = buildContextLedger({
      systemPrompt: 'base prompt',
      conversationHistoryLabel: 'Conversation History',
      conversationHistoryPrompt: 'recent dialogue transcript',
      // fresh 路径不应出现 usedTokens；即使误传，注入的 prompt 文本优先
      conversationHistoryUsedTokens: 999_999,
      userMessage: 'hello',
    })

    const history = result.sections.find((section) => section.label === 'Conversation History')
    expect(history?.estimatedTokens).toBe(estimateTokens('recent dialogue transcript'))
  })
})
