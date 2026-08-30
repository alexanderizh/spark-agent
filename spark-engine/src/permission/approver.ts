import { abortError, throwIfAborted } from '../kernel/cancellation.js';
import type { Approver } from '../seams.js';
import type { PermissionDecision, PermissionRequest } from './types.js';

export class FakeApprover implements Approver {
  readonly #decisions: PermissionDecision[];
  readonly requests: PermissionRequest[] = [];

  constructor(decisions: readonly PermissionDecision[] = []) {
    this.#decisions = [...decisions];
  }

  async ask(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision> {
    this.requests.push(request);
    throwIfAborted(signal);
    await Promise.resolve();
    if (signal.aborted) throw abortError(signal.reason);
    return this.#decisions.shift() ?? { decision: 'deny', reason: 'No approver decision available' };
  }
}
