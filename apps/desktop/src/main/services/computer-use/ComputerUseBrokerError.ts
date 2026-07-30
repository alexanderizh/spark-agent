import type { ComputerUseErrorCode } from '@spark/protocol'
import type { ComputerUseDiagnostic } from './ComputerUseDiagnostic.js'

export type { ComputerUseDiagnostic } from './ComputerUseDiagnostic.js'

/**
 * Optional, additive error metadata. Kept as a separate options bag so the legacy
 * positional `details` argument (used by ~100 existing call sites) stays untouched.
 */
export interface ComputerUseBrokerErrorOptions {
  readonly retryable?: boolean
  readonly diagnostic?: ComputerUseDiagnostic
}

export class ComputerUseBrokerError extends Error {
  readonly code: ComputerUseErrorCode
  readonly details: Readonly<Record<string, string>> | undefined
  /**
   * `true` when the Host (or transport) reported the failure as recoverable by simply
   * retrying the same request. Consumed by the backend to attempt a bounded transparent
   * retry of idempotent operations instead of tearing the connection down.
   */
  readonly retryable: boolean
  readonly diagnostic: ComputerUseDiagnostic | undefined

  constructor(
    code: ComputerUseErrorCode,
    message: string,
    details?: Readonly<Record<string, string>>,
    options?: ComputerUseBrokerErrorOptions,
  ) {
    super(message)
    this.name = 'ComputerUseBrokerError'
    this.code = code
    if (details !== undefined) this.details = details
    this.retryable = options?.retryable === true
    if (options?.diagnostic !== undefined) this.diagnostic = options.diagnostic
  }
}
