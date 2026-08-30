import type { LlmCallContext, LlmService } from '../seams.js'
import type { LlmDelta, LlmRequest } from './types.js'

/**
 * A mutable LlmService used by interactive hosts. The runtime model can be
 * replaced between turns (onboarding picker, /model switcher) while every
 * in-flight turn keeps the service instance it started with: swapping is
 * refused while any stream is open, so a running turn can never observe a
 * model change mid-flight (docs 016 §3.3).
 */
export class SwitchableLlmService implements LlmService {
  #current: LlmService | undefined
  #inFlight = 0

  get current(): LlmService | undefined {
    return this.#current
  }

  set(service: LlmService): void {
    this.assertIdle('switch')
    this.#current = service
  }

  clear(): void {
    this.assertIdle('clear')
    this.#current = undefined
  }

  async *stream(request: LlmRequest, context: LlmCallContext): AsyncIterable<LlmDelta> {
    const service = this.#current
    if (service === undefined) {
      throw new UnconfiguredModelError(
        'No model is configured; select or configure one before starting a turn',
      )
    }
    this.#inFlight += 1
    try {
      yield* service.stream(request, context)
    } finally {
      this.#inFlight -= 1
    }
  }

  private assertIdle(action: string): void {
    if (this.#inFlight > 0) {
      throw new Error(
        `Cannot ${action} the model service while a turn is still in flight; wait for it to finish`,
      )
    }
  }
}

export class UnconfiguredModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnconfiguredModelError'
  }
}
