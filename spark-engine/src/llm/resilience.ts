import { setTimeout as delay } from 'node:timers/promises'

import { isAbortError } from '../kernel/cancellation.js'
import { KernelError } from '../kernel/errors.js'
import type { LlmCallContext, LlmService } from '../seams.js'
import { resolveOutputBudget } from './budget.js'
import { safeDiagnosticText, safeDiagnosticValue } from './error-detail.js'
import type { LlmDelta, LlmRequest, ModelBudget } from './types.js'

export interface LlmRoute {
  readonly id: string
  readonly service: LlmService
}

export interface RetryPolicy {
  readonly maxRetries: number
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly jitterRatio: number
}

export interface ResilientLlmOptions {
  readonly routes: readonly LlmRoute[]
  readonly retry?: Partial<RetryPolicy>
  readonly random?: () => number
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  readonly modelBudget?: ModelBudget
}

const DEFAULT_RETRY: RetryPolicy = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 60_000,
  jitterRatio: 0.2,
}

export class ResilientLlmService implements LlmService {
  readonly #options: ResilientLlmOptions
  readonly #retry: RetryPolicy

  constructor(options: ResilientLlmOptions) {
    if (options.routes.length === 0) throw new Error('At least one LLM route is required')
    if (new Set(options.routes.map((route) => route.id)).size !== options.routes.length) {
      throw new Error('LLM route ids must be unique')
    }
    this.#options = options
    this.#retry = { ...DEFAULT_RETRY, ...options.retry }
    validateRetryPolicy(this.#retry)
  }

  getModelBudget(): ModelBudget | undefined {
    return this.#options.modelBudget
  }

  async *stream(request: LlmRequest, context: LlmCallContext): AsyncIterable<LlmDelta> {
    let lastError: unknown
    for (const [routeIndex, route] of this.#options.routes.entries()) {
      for (let attempt = 0; attempt <= this.#retry.maxRetries; attempt += 1) {
        const output = new StreamOutputState()
        const bookkeeping: LlmDelta[] = []
        try {
          const routeRequest = requestForRoute(request, route.service.getModelBudget?.())
          for await (const delta of route.service.stream(routeRequest, context)) {
            if (isAttemptBookkeeping(delta)) {
              bookkeeping.push(delta)
              continue
            }
            output.observe(delta)
            yield delta
          }
          for (const delta of bookkeeping) yield delta
          return
        } catch (error) {
          if (context.signal.aborted || isAbortError(error)) throw error
          lastError = error
          if (output.hasMeaningfulOutput) {
            throw new KernelError(
              'llm.partial_stream_failed',
              `LLM route ${route.id} failed after emitting output; automatic replay was suppressed`,
              {
                retryable: false,
                cause: error,
                detail: {
                  routeId: route.id,
                  routeIndex,
                  attempt,
                  output: output.detail(),
                  cause: errorDetail(error),
                },
              },
            )
          }
          if (!isRetryable(error)) throw error
          if (attempt < this.#retry.maxRetries) {
            const requestedDelayMs = retryAfterDelay(error)
            if (requestedDelayMs !== undefined && requestedDelayMs > this.#retry.maxDelayMs) {
              lastError = new KernelError(
                'llm.retry_delay_exceeded',
                `LLM route ${route.id} requested a ${requestedDelayMs}ms retry delay, exceeding the configured ${this.#retry.maxDelayMs}ms limit`,
                {
                  cause: error,
                  detail: {
                    routeId: route.id,
                    routeIndex,
                    attempt,
                    requestedDelayMs,
                    maxDelayMs: this.#retry.maxDelayMs,
                    cause: errorDetail(error),
                  },
                },
              )
              break
            }
            const delayMs = retryDelay(error, attempt, this.#retry, this.#options.random)
            yield {
              type: 'retry',
              routeId: route.id,
              attempt: attempt + 1,
              maxRetries: this.#retry.maxRetries,
              delayMs,
              error: retryErrorSummary(error),
            }
            await this.#sleep(delayMs, context.signal)
            continue
          }
        }
      }
    }
    throw lastError
  }

  async #sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (this.#options.sleep) {
      await this.#options.sleep(milliseconds, signal)
      return
    }
    await delay(milliseconds, undefined, { signal })
  }
}

function isAttemptBookkeeping(delta: LlmDelta): boolean {
  return delta.type === 'usage' || delta.type === 'continuation' || delta.type === 'done'
}

/**
 * Only content that an observer can render or act on makes replay unsafe.
 * Usage and provider-continuation bookkeeping are deliberately excluded: the
 * turn has not committed an assistant message yet, so retrying those streams
 * cannot duplicate visible output or execute a tool twice.
 */
class StreamOutputState {
  #textCharacters = 0
  #thinkingCharacters = 0
  #toolCalls = 0

  get hasMeaningfulOutput(): boolean {
    return this.#textCharacters > 0 || this.#thinkingCharacters > 0 || this.#toolCalls > 0
  }

  observe(delta: LlmDelta): void {
    if (delta.type === 'text') this.#textCharacters += delta.text.length
    else if (delta.type === 'thinking') this.#thinkingCharacters += delta.text.length
    else if (delta.type === 'tool_call') this.#toolCalls += 1
  }

  detail(): Record<string, number | boolean> {
    return {
      textCharacters: this.#textCharacters,
      thinkingCharacters: this.#thinkingCharacters,
      toolCalls: this.#toolCalls,
      visible: this.#textCharacters > 0 || this.#thinkingCharacters > 0,
    }
  }
}

function errorDetail(error: unknown): Record<string, unknown> {
  if (error instanceof KernelError) {
    return {
      name: error.name,
      code: error.code,
      message: safeDiagnosticText(error.message),
      retryable: error.retryable,
      ...(error.detail === undefined ? {} : { detail: safeDiagnosticValue(error.detail) }),
    }
  }
  if (error instanceof Error) {
    const nodeError = error as Error & { code?: unknown }
    return {
      name: error.name,
      message: safeDiagnosticText(error.message),
      ...(typeof nodeError.code === 'string'
        ? { code: safeDiagnosticText(nodeError.code, 256) }
        : {}),
    }
  }
  return { message: safeDiagnosticText(String(error)) }
}

function retryErrorSummary(error: unknown): { code?: string; message: string } {
  if (error instanceof KernelError) {
    return { code: error.code, message: safeDiagnosticText(error.message, 512) }
  }
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code
    return {
      ...(typeof code === 'string' ? { code: safeDiagnosticText(code, 256) } : {}),
      message: safeDiagnosticText(error.message, 512),
    }
  }
  return { message: safeDiagnosticText(String(error), 512) }
}

function requestForRoute(request: LlmRequest, modelBudget: ModelBudget | undefined): LlmRequest {
  if (modelBudget === undefined) return request
  const resolved = resolveOutputBudget({
    requestedMaxTokens: request.maxTokens,
    modelBudget,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
  })
  return resolved.maxTokens === request.maxTokens
    ? request
    : { ...request, maxTokens: resolved.maxTokens }
}

function isRetryable(error: unknown): boolean {
  return error instanceof KernelError && error.retryable
}

function retryDelay(
  error: unknown,
  attempt: number,
  policy: RetryPolicy,
  random: (() => number) | undefined,
): number {
  const retryAfterMs = retryAfterDelay(error)
  if (retryAfterMs !== undefined) return Math.max(0, retryAfterMs)
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** attempt)
  const sample = Math.min(1, Math.max(0, (random ?? Math.random)()))
  const jitter = (sample * 2 - 1) * policy.jitterRatio
  return Math.min(policy.maxDelayMs, Math.max(0, Math.round(base * (1 + jitter))))
}

function retryAfterDelay(error: unknown): number | undefined {
  const detail = error instanceof KernelError ? asRecord(error.detail) : undefined
  return numberValue(detail?.retryAfterMs)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function validateRetryPolicy(policy: RetryPolicy): void {
  if (!Number.isInteger(policy.maxRetries) || policy.maxRetries < 0) {
    throw new RangeError('maxRetries must be a non-negative integer')
  }
  if (!Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs < 0) {
    throw new RangeError('initialDelayMs must be a non-negative finite number')
  }
  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < 0) {
    throw new RangeError('maxDelayMs must be a non-negative finite number')
  }
  if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) {
    throw new RangeError('jitterRatio must be between 0 and 1')
  }
}
