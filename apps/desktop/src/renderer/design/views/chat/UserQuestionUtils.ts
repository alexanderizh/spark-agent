import type { UserQuestionPrompt } from '@spark/protocol'

export type UserQuestionData = {
  sessionId: string
  questionId: string
  questions: UserQuestionPrompt[]
}

function isChoiceQuestion(question: UserQuestionPrompt): boolean {
  const type = question.type ?? 'single_choice'
  return type === 'single_choice' || type === 'multi_choice'
}

export function buildQuestionCancelAnswer(questions: UserQuestionPrompt[]): Record<string, unknown> {
  return {
    cancelled: true,
    declined: true,
    reason: '用户取消了问答弹窗，拒绝回答这些问题。',
    questionCount: questions.length,
    answeredCount: 0,
    answers: questions.map((question, index) => ({
      index,
      id: question.id ?? `question-${index + 1}`,
      header: question.header,
      question: question.question,
      type: question.type ?? (isChoiceQuestion(question) ? 'single_choice' : 'text'),
      skipped: true,
      declined: true,
      answer: '用户拒绝回答',
    })),
  }
}
