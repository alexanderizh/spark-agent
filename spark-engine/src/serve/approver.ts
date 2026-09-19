import type { PermissionDecision, PermissionRequest } from '../permission/types.js'
import type { Approver } from '../seams.js'

/**
 * Protocol-side tool approval for `spark serve`.
 *
 * `ask` parks the request until the host answers `POST /v1/approvals/:requestId`
 * (surfaced to the host through the turn's SSE stream, which carries the
 * `permission.requested` event before the approver is consulted). A turn
 * cancellation or dropped stream rejects the pending request, and the tool
 * runner's fail-closed wrapper turns that into a denial.
 */
export interface PendingApproval {
  readonly requestId: string
  readonly callId: string
  readonly tool: string
  readonly argsPreview: string
  readonly reason?: string
  readonly allowedGrantScopes: readonly string[]
}

interface PendingEntry {
  readonly request: PermissionRequest
  readonly resolve: (decision: PermissionDecision) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal
}

export class ServeApprover implements Approver {
  readonly #pending = new Map<string, PendingEntry>()

  /** Requests currently waiting for a host decision, oldest first. */
  listPending(): readonly PendingApproval[] {
    return [...this.#pending.values()].map((entry) => ({
      requestId: entry.request.requestId,
      callId: entry.request.call.callId,
      tool: entry.request.call.name,
      argsPreview: entry.request.argsPreview,
      ...(entry.request.reason === undefined ? {} : { reason: entry.request.reason }),
      allowedGrantScopes: entry.request.allowedGrantScopes,
    }))
  }

  async ask(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
    if (signal.aborted) {
      throw new Error(`Approval ${request.requestId} cancelled before dispatch`)
    }
    return new Promise<PermissionDecision>((resolve, reject) => {
      const onAbort = (): void => {
        if (this.#pending.get(request.requestId) === entry) {
          this.#pending.delete(request.requestId)
          reject(new Error(`Approval ${request.requestId} cancelled`))
        }
      }
      const entry: PendingEntry = {
        request,
        signal,
        resolve: (decision) => {
          signal.removeEventListener('abort', onAbort)
          resolve(decision)
        },
        reject: (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        },
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.#pending.set(request.requestId, entry)
    })
  }

  /** Resolves a pending request. Returns false when the id is unknown/stale. */
  answer(requestId: string, decision: PermissionDecision): boolean {
    const entry = this.#pending.get(requestId)
    if (entry === undefined) return false
    this.#pending.delete(requestId)
    entry.resolve(decision)
    return true
  }

  /** Rejects every pending request; used when the server shuts down. */
  rejectAll(reason: string): void {
    for (const entry of this.#pending.values()) entry.reject(new Error(reason))
    this.#pending.clear()
  }
}
