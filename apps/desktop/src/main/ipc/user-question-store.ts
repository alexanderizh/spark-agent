import type { UserQuestionPrompt, UserQuestionRequest } from '@spark/protocol'

export type UserQuestionCloseReason = 'answered' | 'cancelled' | 'aborted'

type PendingQuestion = {
  request: UserQuestionRequest
  promise: Promise<Record<string, unknown>>
  resolve: (answers: Record<string, unknown>) => void
  detached: boolean
  settling: boolean
  sourceTurnId?: string | undefined
  signal?: AbortSignal | undefined
  onAbort?: (() => void) | undefined
}

type PendingUserQuestionStoreOptions = {
  onRequest: (request: UserQuestionRequest) => void
  onClose: (request: UserQuestionRequest, reason: UserQuestionCloseReason) => void
  onDetachedAnswer?: (
    request: UserQuestionRequest,
    answers: Record<string, unknown>,
    context: { sourceTurnId?: string | undefined },
  ) => Promise<void>
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
    sourceTurnId?: string | undefined
    signal?: AbortSignal
  }): Promise<Record<string, unknown>> {
    const key = questionKey(params.sessionId, params.questionId)
    const existing = this.pending.get(key)
    if (existing != null) {
      if (params.signal != null && params.signal !== existing.signal) {
        this.attachSignal(existing, params.signal)
      }
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
      detached: false,
      settling: false,
      sourceTurnId: params.sourceTurnId,
    }
    this.pending.set(key, entry)
    if (params.signal != null) this.attachSignal(entry, params.signal)
    this.options.onRequest(request)
    return promise
  }

  list(sessionId?: string): UserQuestionRequest[] {
    return [...this.pending.values()]
      .map((entry) => entry.request)
      .filter((request) => sessionId == null || request.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async resolve(
    sessionId: string,
    questionId: string,
    answers: Record<string, unknown>,
  ): Promise<boolean> {
    const entry = this.pending.get(questionKey(sessionId, questionId))
    if (entry == null || entry.settling) return false
    entry.settling = true
    try {
      if (
        entry.detached &&
        answers.cancelled !== true &&
        answers.declined !== true &&
        this.options.onDetachedAnswer != null
      ) {
        await this.options.onDetachedAnswer(entry.request, answers, {
          sourceTurnId: entry.sourceTurnId,
        })
      }
      return this.finish(sessionId, questionId, answers, 'answered')
    } catch (error) {
      entry.settling = false
      throw error
    }
  }

  cancelSession(sessionId: string): void {
    for (const entry of [...this.pending.values()]) {
      if (entry.request.sessionId !== sessionId) continue
      this.finish(sessionId, entry.request.questionId, { cancelled: true }, 'cancelled')
    }
  }

  private attachSignal(entry: PendingQuestion, signal: AbortSignal): void {
    if (entry.signal != null && entry.onAbort != null) {
      entry.signal.removeEventListener('abort', entry.onAbort)
    }
    entry.signal = signal
    entry.detached = false
    entry.onAbort = () => {
      // The SDK control channel is transport state, not user intent. Keep the
      // question visible and pending; a later answer will be sent as a fresh turn.
      entry.detached = true
      signal.removeEventListener('abort', entry.onAbort!)
      entry.signal = undefined
      entry.onAbort = undefined
    }
    if (signal.aborted) entry.onAbort()
    else signal.addEventListener('abort', entry.onAbort, { once: true })
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
