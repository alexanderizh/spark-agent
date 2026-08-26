import { abortError } from '../kernel/cancellation.js';
import type { Approver } from '../seams.js';
import type { PermissionDecision, PermissionRequest } from './types.js';

export interface PendingApproval {
  readonly request: PermissionRequest;
}

type Listener = (pending: PendingApproval | undefined) => void;

interface PendingRecord extends PendingApproval {
  readonly resolve: (decision: PermissionDecision) => void;
  readonly reject: (error: unknown) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

export class InteractiveApprover implements Approver {
  readonly #listeners = new Set<Listener>();
  #pending: PendingRecord | undefined;

  ask(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
    if (this.#pending) {
      return Promise.resolve({ decision: 'deny', reason: 'Another approval is already pending' });
    }
    if (signal.aborted) return Promise.reject(abortError(signal.reason));
    return new Promise<PermissionDecision>((resolve, reject) => {
      const onAbort = () => {
        this.#finish();
        reject(abortError(signal.reason));
      };
      this.#pending = { request, resolve, reject, signal, onAbort };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#notify();
    });
  }

  decide(requestId: string, decision: PermissionDecision): boolean {
    const pending = this.#pending;
    if (pending?.request.requestId !== requestId) return false;
    this.#finish();
    pending.resolve(decision);
    return true;
  }

  current(): PendingApproval | undefined {
    return this.#pending ? { request: this.#pending.request } : undefined;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.current());
    return () => this.#listeners.delete(listener);
  }

  #finish(): void {
    const pending = this.#pending;
    pending?.signal.removeEventListener('abort', pending.onAbort);
    this.#pending = undefined;
    this.#notify();
  }

  #notify(): void {
    const current = this.current();
    for (const listener of this.#listeners) listener(current);
  }
}
