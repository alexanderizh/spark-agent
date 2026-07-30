import { describe, expect, it } from 'vitest'
import type { UserQuestionPrompt } from '@spark/protocol'
import { isOptionalUserQuestion } from './user-question-readiness'

const question = (overrides: Partial<UserQuestionPrompt> = {}): UserQuestionPrompt => ({
  header: '审批意见',
  question: '请填写审批意见',
  type: 'text',
  ...overrides,
})

describe('isOptionalUserQuestion', () => {
  it('treats an explicitly skippable question as optional', () => {
    expect(isOptionalUserQuestion(question({ allowSkip: true }))).toBe(true)
  })

  it('treats a non-required question as optional', () => {
    expect(isOptionalUserQuestion(question({ required: false }))).toBe(true)
  })

  it('keeps required questions blocking submission', () => {
    expect(isOptionalUserQuestion(question({ required: true }))).toBe(false)
  })
})
