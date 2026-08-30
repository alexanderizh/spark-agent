import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import {
  buildDetachedQuestionContinuationMessage,
  recoverDetachedQuestionAttachments,
} from './user-question-recovery.js'

describe('buildDetachedQuestionContinuationMessage', () => {
  it('assembles the original questions and submitted answers into a continuation turn', () => {
    const message = buildDetachedQuestionContinuationMessage(
      {
        sessionId: 'session-1',
        questionId: 'question-1',
        createdAt: '2026-07-16T00:00:00.000Z',
        questions: [
          { header: 'URL', question: '使用永久 URL 吗？', options: [{ label: '是' }] },
          { header: '节奏', question: '怎么安排？', type: 'text' },
        ],
      },
      {
        answers: [
          { selectedLabel: '是', answer: '使用永久 URL' },
          { text: '先修复问答，再升级 SDK' },
        ],
      },
    )

    expect(message).toContain('问题：使用永久 URL 吗？')
    expect(message).toContain('用户回答：使用永久 URL')
    expect(message).toContain('问题：怎么安排？')
    expect(message).toContain('用户回答：先修复问答，再升级 SDK')
    expect(message).toContain('不要重复提问')
  })

  it('prints skipped answers explicitly in detached continuation turns', () => {
    const message = buildDetachedQuestionContinuationMessage(
      {
        sessionId: 'session-1',
        questionId: 'question-1',
        createdAt: '2026-07-16T00:00:00.000Z',
        questions: [{ header: '审批', question: '继续吗？', options: [{ label: '继续' }] }],
      },
      {
        answers: [{ skipped: true, answer: '' }],
      },
    )

    expect(message).toContain('用户回答：用户选择跳过')
  })

  it('recovers attachments from the source turn before falling back to newer turns', () => {
    const events: AgentEvent[] = [
      {
        id: 'event-1',
        type: 'user_message',
        sessionId: 'session-1',
        turnId: 'turn-source',
        timestamp: '2026-07-16T00:00:00.000Z',
        seq: 1,
        content: '看这张图',
        attachments: [
          { type: 'image', path: '/tmp/source.png', name: 'source.png' },
          { type: 'image', path: '/tmp/source.png', name: 'source.png' },
        ],
      },
      {
        id: 'event-2',
        type: 'user_message',
        sessionId: 'session-1',
        turnId: 'turn-newer',
        timestamp: '2026-07-16T00:01:00.000Z',
        seq: 2,
        content: '后来一轮',
        attachments: [{ type: 'file', path: '/tmp/newer.txt', name: 'newer.txt' }],
      },
    ]

    expect(recoverDetachedQuestionAttachments(events, 'turn-source')).toEqual([
      { type: 'image', path: '/tmp/source.png' },
    ])
  })

  it('falls back to the newest recoverable attachments when source turn metadata is absent', () => {
    const events: AgentEvent[] = [
      {
        id: 'event-1',
        type: 'user_message',
        sessionId: 'session-1',
        turnId: 'turn-old',
        timestamp: '2026-07-16T00:00:00.000Z',
        seq: 1,
        content: '旧附件',
        attachments: [{ type: 'file', path: '/tmp/old.txt', name: 'old.txt' }],
      },
      {
        id: 'event-2',
        type: 'user_message',
        sessionId: 'session-1',
        turnId: 'turn-new',
        timestamp: '2026-07-16T00:01:00.000Z',
        seq: 2,
        content: '新附件',
        attachments: [{ type: 'image', path: '/tmp/new.png', name: 'new.png' }],
      },
    ]

    expect(recoverDetachedQuestionAttachments(events)).toEqual([
      { type: 'image', path: '/tmp/new.png' },
    ])
  })

  it('recovers attachment paths from a turn prompt snapshot ledger', () => {
    const events: AgentEvent[] = [
      {
        id: 'event-1',
        type: 'turn_prompt_snapshot',
        sessionId: 'session-1',
        turnId: 'turn-source',
        timestamp: '2026-07-16T00:00:00.000Z',
        seq: 1,
        userMessage: [
          '看图修界面',
          '',
          'Attachments:',
          '1. image: screenshot.png (/tmp/screenshot.png)',
        ].join('\n'),
        systemPromptSections: [],
        model: 'claude-sonnet',
        adapterKind: 'claude-sdk',
        permissionMode: 'claude-ask',
        toolCount: 0,
      },
    ]

    expect(recoverDetachedQuestionAttachments(events, 'turn-source')).toEqual([
      { type: 'image', path: '/tmp/screenshot.png' },
    ])
  })
})
