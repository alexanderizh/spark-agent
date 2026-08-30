import type { UserQuestionPrompt } from '@spark/protocol'

export function isOptionalUserQuestion(question: UserQuestionPrompt): boolean {
  return question.required === false || question.allowSkip === true
}
