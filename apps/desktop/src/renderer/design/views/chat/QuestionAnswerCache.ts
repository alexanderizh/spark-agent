import type { UserQuestionPrompt } from '@spark/protocol'

export type QuestionAnswerSummary = {
  question: string
  answer: string
  skipped?: boolean
}

const questionAnswerCache = new Map<string, QuestionAnswerSummary[]>()
const QUESTION_ANSWER_STORAGE_PREFIX = 'spark:question-answer:'

export function getQuestionAnswerCacheKey(
  questions: UserQuestionPrompt[],
  sessionId?: string,
): string {
  return `${sessionId ?? 'global'}::${questions.map((question) => question.question).join('\0')}`
}

export function buildQuestionAnswerSummaries(
  questions: UserQuestionPrompt[],
  answers: Record<string, unknown>,
): QuestionAnswerSummary[] {
  const rawList = Array.isArray(answers.answers) ? answers.answers : []
  return questions
    .map((question, index) => {
      const raw = rawList[index] as Record<string, unknown> | undefined
      if (raw == null || typeof raw !== 'object') return null
      const text =
        typeof raw.answer === 'string'
          ? raw.answer
          : typeof raw.text === 'string'
            ? raw.text
            : ''
      if (!text && raw.skipped !== true) return null
      return {
        question: question.question,
        answer: text,
        ...(raw.skipped === true ? { skipped: true } : {}),
      }
    })
    .filter((item): item is QuestionAnswerSummary => item != null)
}

export function persistQuestionAnswerSummaries(
  cacheKey: string,
  summaries: QuestionAnswerSummary[],
): void {
  questionAnswerCache.set(cacheKey, summaries)
  try {
    window.localStorage.setItem(
      `${QUESTION_ANSWER_STORAGE_PREFIX}${cacheKey}`,
      JSON.stringify(summaries),
    )
  } catch {
    // localStorage may be unavailable in restricted renderer contexts.
  }
}

export function readPersistedQuestionAnswerSummaries(
  cacheKey: string,
): QuestionAnswerSummary[] | undefined {
  const cached = questionAnswerCache.get(cacheKey)
  if (cached != null) return cached

  try {
    const raw = window.localStorage.getItem(`${QUESTION_ANSWER_STORAGE_PREFIX}${cacheKey}`)
    if (raw == null) return undefined
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return undefined
    return parsed.filter((item): item is QuestionAnswerSummary => {
      if (item == null || typeof item !== 'object') return false
      const value = item as Record<string, unknown>
      return (
        typeof value.question === 'string' &&
        typeof value.answer === 'string' &&
        (value.skipped == null || typeof value.skipped === 'boolean')
      )
    })
  } catch {
    return undefined
  }
}
