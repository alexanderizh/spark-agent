import { createLogger } from '@spark/shared'
import type { UserQuestionPrompt, UserQuestionRequest } from '@spark/protocol'

const log = createLogger('user-question-store')

// Diagnostic prefix used by askUserQuestion reliability logs. Grep this to
// reconstruct the lifecycle of a single question call when the SDK reports
// "Tool permission request failed: Stream closed" but the dialog never opened.
const DIAG = '[QUESTION-DIAG]'

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
      log.info(`${DIAG} store.request reattach`, {
        sessionId: params.sessionId,
        questionId: params.questionId,
        detached: existing.detached,
        settling: existing.settling,
        signalAborted: params.signal?.aborted ?? null,
        previousSignalAborted: existing.signal?.aborted ?? null,
      })
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
    log.info(`${DIAG} store.request new`, {
      sessionId: params.sessionId,
      questionId: params.questionId,
      sourceTurnId: params.sourceTurnId ?? null,
      questionCount: params.questions.length,
      signalProvided: params.signal != null,
      signalAborted: params.signal?.aborted ?? null,
      pendingBefore: this.pending.size - 1,
    })
    if (params.signal != null) this.attachSignal(entry, params.signal)
    try {
      this.options.onRequest(request)
      log.info(`${DIAG} store.request onRequest returned`, {
        sessionId: params.sessionId,
        questionId: params.questionId,
      })
    } catch (error) {
      log.error(`${DIAG} store.request onRequest threw`, {
        sessionId: params.sessionId,
        questionId: params.questionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
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
    if (entry == null || entry.settling) {
      log.warn(`${DIAG} store.resolve ignored`, {
        sessionId,
        questionId,
        found: entry != null,
        settling: entry?.settling ?? null,
      })
      return false
    }
    log.info(`${DIAG} store.resolve entry`, {
      sessionId,
      questionId,
      detached: entry.detached,
      cancelled: answers.cancelled === true,
      declined: answers.declined === true,
      willInvokeOnDetachedAnswer:
        entry.detached &&
        answers.cancelled !== true &&
        answers.declined !== true &&
        this.options.onDetachedAnswer != null,
    })
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
      log.error(`${DIAG} store.resolve threw`, {
        sessionId,
        questionId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }
  }

  cancelSession(sessionId: string): void {
    let cancelledCount = 0
    for (const entry of [...this.pending.values()]) {
      if (entry.request.sessionId !== sessionId) continue
      this.finish(sessionId, entry.request.questionId, { cancelled: true }, 'cancelled')
      cancelledCount += 1
    }
    if (cancelledCount > 0) {
      log.info(`${DIAG} store.cancelSession`, {
        sessionId,
        cancelledCount,
      })
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
      log.warn(`${DIAG} store.attachSignal.onAbort fired`, {
        sessionId: entry.request.sessionId,
        questionId: entry.request.questionId,
        alreadyAborted: signal.aborted,
        source: 'SDK control stream closed or aborted',
      })
    }
    if (signal.aborted) {
      log.warn(`${DIAG} store.attachSignal already aborted before attach`, {
        sessionId: entry.request.sessionId,
        questionId: entry.request.questionId,
      })
      entry.onAbort()
    } else {
      signal.addEventListener('abort', entry.onAbort, { once: true })
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
    log.info(`${DIAG} store.finish`, {
      sessionId,
      questionId,
      reason,
      detached: entry.detached,
      cancelled: answers.cancelled === true,
      declined: answers.declined === true,
      remainingPending: this.pending.size,
    })
    try {
      this.options.onClose(entry.request, reason)
    } catch (error) {
      log.error(`${DIAG} store.finish onClose threw`, {
        sessionId,
        questionId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return true
  }
}
