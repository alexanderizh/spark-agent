/**
 * Spark Agent 统一错误类型定义
 */

export type ErrorCode =
  // 通用
  | 'UNKNOWN'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'PERMISSION_DENIED'
  // Provider / Agent
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_QUOTA_EXCEEDED'
  | 'AGENT_SESSION_NOT_FOUND'
  | 'AGENT_ALREADY_RUNNING'
  | 'AGENT_CANCELLED'
  // Keystore
  | 'KEYSTORE_UNAVAILABLE'
  | 'KEYSTORE_KEY_NOT_FOUND'
  // Workspace
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_ACCESS_DENIED'
  | 'WORKSPACE_PATH_OUTSIDE_ROOT'
  | 'GIT_OPERATION_FAILED'
  // IPC
  | 'IPC_HANDLER_NOT_FOUND'
  | 'IPC_INVALID_PAYLOAD'

export class SparkError extends Error {
  readonly code: ErrorCode
  readonly context?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, context?: Record<string, unknown>) {
    super(message)
    this.name = 'SparkError'
    this.code = code
    // exactOptionalPropertyTypes: true requires conditional assignment for optional props
    if (context !== undefined) {
      this.context = context
    }
    // Maintains proper stack trace for where error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SparkError)
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    }
  }
}

export function isSparkError(err: unknown): err is SparkError {
  return err instanceof SparkError
}
