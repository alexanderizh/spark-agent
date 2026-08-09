import { SparkError, type ErrorCode } from '@spark/shared'

export type RuntimeErrorCode = Extract<
  ErrorCode,
  | 'PLUGIN_DISABLED'
  | 'RUNTIME_UNAVAILABLE'
  | 'ACCOUNT_REQUIRED'
  | 'ACCOUNT_SELECTION_REQUIRED'
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'SCOPE_REQUIRED'
  | 'CAPABILITY_DISABLED'
  | 'RESOURCE_OUT_OF_SCOPE'
  | 'CONFIRMATION_REQUIRED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'PROVIDER_UNAVAILABLE'
>

export class RuntimeError extends SparkError {
  readonly retryAfterMs?: number

  constructor(
    code: RuntimeErrorCode,
    message: string,
    context?: Record<string, unknown>,
    retryAfterMs?: number,
  ) {
    super(code, message, context)
    this.name = 'RuntimeError'
    if (retryAfterMs !== undefined) this.retryAfterMs = retryAfterMs
  }
}

export function runtimeErrorCodeForHttp(status: number): RuntimeErrorCode {
  if (status === 401) return 'AUTH_EXPIRED'
  if (status === 403) return 'SCOPE_REQUIRED'
  if (status === 404) return 'RUNTIME_UNAVAILABLE'
  if (status === 409) return 'CONFLICT'
  if (status === 429) return 'RATE_LIMITED'
  return 'PROVIDER_UNAVAILABLE'
}
