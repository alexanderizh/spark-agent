import type { UserQuestionPrompt, UserQuestionRequest } from '@spark/protocol'

export type UserQuestionCloseReason = 'answered' | 'cancelled' | 'aborted'

type PendingQuestion = {
  request: UserQuestionRequest
  promise: Promise<Record<string, unknown>>
  resolve: (answers: Record<string, unknown>) => void
  signal?: AbortSignal
  onAbort?: () => void
}

type PendingUserQuestionStoreOptions = {
  onRequest: (request: UserQuestionRequest) => void
  onClose: (request: UserQuestionRequest, reason: UserQuestionCloseReason) => void
}

function questionKey(sessionId: string, questionId: string): string {
  return `${sessionId}\u0000${questionId}`
}

export class PendingUserQuestionStore {
  private readonly pending = new Map<string, PendingQuestion>()

  constructor(private readonly options: PendingUserQuestionStoreOptions) {}

  request(params: {
    questionId: string
    sessionId: string
    questions: UserQuestionPrompt[]
    signal?: AbortSignal
  }): Promise<Record<string, unknown>> {
    const key = questionKey(params.sessionId, params.questionId)
    const existing = this.pending.get(key)
    if (existing != null) {
      this.options.onRequest(existing.request)
      return existing.promise
    }

    const request: UserQuestionRequest = {
      questionId: params.questionId,
      sessionId: params.sessionId,
      questions: params.questions,
      createdAt: new Date().toISOString(),
    }
    let resolvePromise: ((answers: Record<string, unknown>) => void) | undefined
    const promise = new Promise<Record<string, unknown>>((resolve) => {
      resolvePromise = resolve
    })
    const entry: PendingQuestion = {
      request,
      promise,
      resolve: (answers) => resolvePromise?.(answers),
      ...(params.signal != null ? { signal: params.signal } : {}),
    }
    this.pending.set(key, entry)
    if (params.signal != null) {
      entry.onAbort = () => {
        this.finish(request.sessionId, request.questionId, { cancelled: true }, 'aborted')
      }
      if (params.signal.aborted) {
        entry.onAbort()
        return promise
      }
      params.signal.addEventListener('abort', entry.onAbort, { once: true })
    }
    this.options.onRequest(request)
    return promise
  }

  list(sessionId?: string): UserQuestionRequest[] {
    return [...this.pending.values()]
      .map((entry) => entry.request)
      .filter((request) => sessionId == null || request.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  resolve(sessionId: string, questionId: string, answers: Record<string, unknown>): boolean {
    return this.finish(sessionId, questionId, answers, 'answered')
  }

  cancelSession(sessionId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.request.sessionId !== sessionId) continue
      this.finish(sessionId, entry.request.questionId, { cancelled: true }, 'cancelled')
    }
  }

  private finish(
    sessionId: string,
    questionId: string,
    answers: Record<string, unknown>,
    reason: UserQuestionCloseReason,
  ): boolean {
    const key = questionKey(sessionId, questionId)
    const entry = this.pending.get(key)
    if (entry == null) return false
    this.pending.delete(key)
    if (entry.signal != null && entry.onAbort != null) {
      entry.signal.removeEventListener('abort', entry.onAbort)
    }
    entry.resolve(answers)
    this.options.onClose(entry.request, reason)
    return true
  }
}
