import type { UserQuestionPrompt } from '@spark/protocol'

export type UserQuestionData = {
  sessionId: string
  questionId: string
  questions: UserQuestionPrompt[]
}
