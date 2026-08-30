import { setTimeout as delay } from 'node:timers/promises';

import { isAbortError } from '../kernel/cancellation.js';
import { KernelError } from '../kernel/errors.js';
import type { LlmCallContext, LlmService } from '../seams.js';
import type { LlmDelta, LlmRequest } from './types.js';

export interface LlmRoute {
  readonly id: string;
  readonly service: LlmService;
}

export interface RetryPolicy {
  readonly maxRetries: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitterRatio: number;
}

export interface ResilientLlmOptions {
  readonly routes: readonly LlmRoute[];
  readonly retry?: Partial<RetryPolicy>;
  readonly random?: () => number;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 8_000,
  jitterRatio: 0.2,
};

export class ResilientLlmService implements LlmService {
  readonly #options: ResilientLlmOptions;
  readonly #retry: RetryPolicy;

  constructor(options: ResilientLlmOptions) {
    if (options.routes.length === 0) throw new Error('At least one LLM route is required');
    if (new Set(options.routes.map((route) => route.id)).size !== options.routes.length) {
      throw new Error('LLM route ids must be unique');
    }
    this.#options = options;
    this.#retry = { ...DEFAULT_RETRY, ...options.retry };
  }

  async *stream(request: LlmRequest, context: LlmCallContext): AsyncIterable<LlmDelta> {
    let lastError: unknown;
    for (const [routeIndex, route] of this.#options.routes.entries()) {
      for (let attempt = 0; attempt <= this.#retry.maxRetries; attempt += 1) {
        let emitted = false;
        try {
          for await (const delta of route.service.stream(request, context)) {
            if (delta.type !== 'heartbeat') emitted = true;
            yield delta;
          }
          return;
        } catch (error) {
          if (context.signal.aborted || isAbortError(error)) throw error;
          lastError = error;
          if (emitted) {
            throw new KernelError(
              'llm.partial_stream_failed',
              `LLM route ${route.id} failed after emitting output; automatic replay was suppressed`,
              {
                retryable: false,
                cause: error,
                detail: { routeId: route.id, routeIndex, attempt },
              },
            );
          }
          if (!isRetryable(error)) throw error;
          if (attempt < this.#retry.maxRetries) {
            await this.#sleep(
              retryDelay(error, attempt, this.#retry, this.#options.random),
              context.signal,
            );
            continue;
          }
        }
      }
    }
    throw lastError;
  }

  async #sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (this.#options.sleep) {
      await this.#options.sleep(milliseconds, signal);
      return;
    }
    await delay(milliseconds, undefined, { signal });
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof KernelError && error.retryable;
}

function retryDelay(
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
  random: (() => number) | undefined,
): number {
  const detail = error instanceof KernelError ? asRecord(error.detail) : undefined;
  const retryAfterMs = numberValue(detail?.retryAfterMs);
  if (retryAfterMs !== undefined) return Math.min(policy.maxDelayMs, Math.max(0, retryAfterMs));
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** attempt);
  const sample = Math.min(1, Math.max(0, (random ?? Math.random)()));
  const jitter = (sample * 2 - 1) * policy.jitterRatio;
  return Math.max(0, Math.round(base * (1 + jitter)));
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
