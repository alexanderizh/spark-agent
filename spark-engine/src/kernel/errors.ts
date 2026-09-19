import type { ErrorInfo } from '../events/schema.js'

export class KernelError extends Error {
  readonly code: string
  readonly retryable: boolean
  readonly detail?: unknown

  constructor(
    code: string,
    message: string,
    options: {
      readonly retryable?: boolean
      readonly detail?: unknown
      readonly cause?: unknown
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'KernelError'
    this.code = code
    this.retryable = options.retryable ?? false
    if (options.detail !== undefined) this.detail = options.detail
  }
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof KernelError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    }
  }
  if (error instanceof Error) {
    return {
      code: 'kernel.unexpected',
      message: error.message,
      retryable: false,
      detail: { name: error.name },
    }
  }
  return { code: 'kernel.unexpected', message: String(error), retryable: false }
}

/**
 * Structured environment-startup failure reasons (mirrors the Claude SDK's
 * SDKStartupFailureReason and Codex diagnostics patterns). Hosts classify on
 * these instead of parsing message text; unknown causes stay undefined and
 * fall back to the generic error path.
 */
export const STARTUP_FAILURE_REASONS = [
  'provider_unconfigured',
  'provider_unreachable',
  'provider_auth_rejected',
  'model_unavailable',
  'mcp_server_connect_failed',
  'mcp_tools_discovery_failed',
  'hooks_config_invalid',
  'workspace_unavailable',
  'engine_version_incompatible',
] as const

export type StartupFailureReason = (typeof STARTUP_FAILURE_REASONS)[number]

export function isStartupFailureReason(value: unknown): value is StartupFailureReason {
  return typeof value === 'string' && (STARTUP_FAILURE_REASONS as readonly string[]).includes(value)
}

/** Stable kernel error code for a structured startup failure. */
export function startupFailureCode(reason: StartupFailureReason): string {
  return `kernel.startup_failed.${reason}`
}

/** Wraps an environment-construction failure with its structured reason. */
export class StartupFailureError extends KernelError {
  readonly reason: StartupFailureReason

  constructor(
    reason: StartupFailureReason,
    message: string,
    options: { readonly cause?: unknown } = {},
  ) {
    super(startupFailureCode(reason), message, { retryable: false, cause: options.cause })
    this.name = 'StartupFailureError'
    this.reason = reason
  }
}
