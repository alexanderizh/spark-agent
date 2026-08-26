export class AgentAbortError extends Error {
  readonly code = 'kernel.aborted';

  constructor(message = 'Operation aborted', options?: ErrorOptions) {
    super(message, options);
    this.name = 'AbortError';
  }
}

export function abortError(reason?: unknown): AgentAbortError {
  if (reason instanceof AgentAbortError) return reason;
  if (reason instanceof Error) return new AgentAbortError(reason.message, { cause: reason });
  return new AgentAbortError(
    reason === undefined
      ? 'Operation aborted'
      : typeof reason === 'string' || typeof reason === 'number' || typeof reason === 'boolean'
        ? String(reason)
        : 'Operation aborted',
  );
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof AgentAbortError ||
    (error instanceof Error && (error.name === 'AbortError' || Reflect.get(error, 'code') === 'ABORT_ERR'))
  );
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError(signal.reason);
}

export class CancellationTree {
  readonly #controller = new AbortController();
  readonly #children = new Set<CancellationTree>();
  readonly #parent?: CancellationTree;
  readonly #parentSignal?: AbortSignal;
  readonly #parentListener?: () => void;

  constructor(parent?: CancellationTree | AbortSignal) {
    if (parent instanceof CancellationTree) {
      this.#parent = parent;
      parent.#children.add(this);
      this.#parentSignal = parent.signal;
    } else if (parent) {
      this.#parentSignal = parent;
    }
    if (this.#parentSignal) {
      this.#parentListener = () => {
        this.abort(this.#parentSignal?.reason);
      };
      if (this.#parentSignal.aborted) this.#parentListener();
      else this.#parentSignal.addEventListener('abort', this.#parentListener, { once: true });
    }
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  child(): CancellationTree {
    return new CancellationTree(this);
  }

  abort(reason?: unknown): void {
    if (this.#controller.signal.aborted) return;
    this.#controller.abort(reason ?? new AgentAbortError());
    for (const child of this.#children) child.abort(this.#controller.signal.reason);
  }

  dispose(): void {
    if (this.#parent) this.#parent.#children.delete(this);
    if (this.#parentSignal && this.#parentListener) {
      this.#parentSignal.removeEventListener('abort', this.#parentListener);
    }
    for (const child of this.#children) child.dispose();
    this.#children.clear();
  }
}

export function timeoutSignal(parent: AbortSignal, timeoutMs: number): {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  let didTimeout = false;
  const onParentAbort = () => {
    controller.abort(parent.reason);
  };
  if (parent.aborted) onParentAbort();
  else parent.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new KernelTimeoutError(timeoutMs));
  }, timeoutMs);
  timer.unref();
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onParentAbort);
    },
  };
}

export class KernelTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}
