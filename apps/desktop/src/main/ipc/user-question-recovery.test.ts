import { describe, expect, it } from 'vitest'
import { buildDetachedQuestionContinuationMessage } from './user-question-recovery.js'

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
})
