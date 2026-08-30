import { abortError, throwIfAborted } from './cancellation.js';

interface QueueEntry<Result> {
  readonly signal?: AbortSignal;
  readonly run: () => Promise<Result>;
  readonly resolve: (result: Result) => void;
  readonly reject: (error: unknown) => void;
}

interface SessionQueue {
  active: boolean;
  readonly entries: QueueEntry<unknown>[];
}

export class SessionScheduler {
  readonly #sessions = new Map<string, SessionQueue>();

  schedule<Result>(options: {
    readonly sessionId: string;
    readonly signal?: AbortSignal;
    readonly onQueued?: () => Promise<void> | void;
    readonly run: () => Promise<Result>;
  }): Promise<Result> {
    const queue = this.#sessions.get(options.sessionId) ?? { active: false, entries: [] };
    this.#sessions.set(options.sessionId, queue);
    const isQueued = queue.active || queue.entries.length > 0;
    const queuedNotice = isQueued ? Promise.resolve().then(options.onQueued) : Promise.resolve();
    const result = new Promise<Result>((resolve, reject) => {
      queue.entries.push({
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        run: async () => {
          await queuedNotice;
          return options.run();
        },
        resolve: resolve as (value: unknown) => void,
        reject,
      });
    });
    void this.#drain(options.sessionId, queue);
    return result;
  }

  queued(sessionId: string): number {
    const queue = this.#sessions.get(sessionId);
    if (!queue) return 0;
    return queue.entries.length;
  }

  async #drain(sessionId: string, queue: SessionQueue): Promise<void> {
    if (queue.active) return;
    queue.active = true;
    try {
      while (queue.entries.length > 0) {
        const entry = queue.entries.shift();
        if (!entry) break;
        try {
          if (entry.signal) throwIfAborted(entry.signal);
          entry.resolve(await entry.run());
        } catch (error) {
          entry.reject(entry.signal?.aborted ? abortError(entry.signal.reason) : error);
        }
      }
    } finally {
      queue.active = false;
      if (queue.entries.length === 0) this.#sessions.delete(sessionId);
    }
  }
}
