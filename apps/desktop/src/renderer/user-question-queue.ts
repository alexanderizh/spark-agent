import type { UserQuestionRequest } from '@spark/protocol'

export type UserQuestionQueues = Record<string, UserQuestionRequest[]>

export function enqueueUserQuestions(
  current: UserQuestionQueues,
  requests: UserQuestionRequest[],
): UserQuestionQueues {
  if (requests.length === 0) return current
  const next = { ...current }
  for (const request of requests) {
    const queue = next[request.sessionId] ?? []
    const index = queue.findIndex((item) => item.questionId === request.questionId)
    const updated =
      index >= 0
        ? queue.map((item, itemIndex) => (itemIndex === index ? request : item))
        : [...queue, request]
    next[request.sessionId] = updated.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  return next
}

export function removeUserQuestion(
  current: UserQuestionQueues,
  sessionId: string,
  questionId?: string,
): UserQuestionQueues {
  const queue = current[sessionId]
  if (queue == null) return current
  const remaining =
    questionId == null ? [] : queue.filter((request) => request.questionId !== questionId)
  const next = { ...current }
  if (remaining.length === 0) delete next[sessionId]
  else next[sessionId] = remaining
  return next
}
