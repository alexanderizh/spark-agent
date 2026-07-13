import { describe, expect, it } from 'vitest'
import type { UserQuestionRequest } from '@spark/protocol'
import { enqueueUserQuestions, removeUserQuestion } from './user-question-queue'

function request(questionId: string, createdAt: string): UserQuestionRequest {
  return {
    questionId,
    sessionId: 'session-1',
    questions: [{ header: '确认', question: questionId }],
    createdAt,
  }
}

describe('user question queue', () => {
  it('merges replay and live events without duplicates and preserves creation order', () => {
    const later = request('later', '2026-07-13T02:00:00.000Z')
    const earlier = request('earlier', '2026-07-13T01:00:00.000Z')
    const current = enqueueUserQuestions({}, [later])
    const merged = enqueueUserQuestions(current, [earlier, later])

    expect(merged['session-1']?.map((item) => item.questionId)).toEqual(['earlier', 'later'])
  })

  it('removes only the closed question from a session queue', () => {
    const current = enqueueUserQuestions({}, [
      request('first', '2026-07-13T01:00:00.000Z'),
      request('second', '2026-07-13T02:00:00.000Z'),
    ])

    expect(removeUserQuestion(current, 'session-1', 'first')['session-1']?.[0]?.questionId).toBe(
      'second',
    )
  })
})
