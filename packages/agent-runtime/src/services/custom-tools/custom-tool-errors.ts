/**
 * 自定义工具错误口径（对齐方案 §5.3）
 *
 * toolCode 面向 LLM/桥（机器可读，出现在 MCP tool error 文本里）；
 * toSparkError() 面向 renderer IPC（保留可读的中文 message）。
 */

import { SparkError } from '@spark/shared'
import type { ErrorCode } from '@spark/shared'

export const CUSTOM_TOOL_ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_TEMPLATE',
  'SECRET_MISSING',
  'TIMEOUT',
  'UNREACHABLE',
  'HTTP_ERROR',
  'EXECUTION_FAILED',
  'NOT_IMPLEMENTED',
  'DENIED',
  'NOT_FOUND',
  'ALREADY_EXISTS',
] as const
export type CustomToolErrorCode = (typeof CUSTOM_TOOL_ERROR_CODES)[number]

export class CustomToolError extends Error {
  readonly toolCode: CustomToolErrorCode
  traceId?: number

  constructor(toolCode: CustomToolErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CustomToolError'
    this.toolCode = toolCode
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CustomToolError)
    }
  }

  toSparkError(): SparkError {
    return new SparkError(this.ipcErrorCode(), this.message, {
      toolCode: this.toolCode,
      ...(this.traceId != null ? { traceId: this.traceId } : {}),
    })
  }

  attachTraceId(traceId: number | undefined): this {
    if (traceId != null) this.traceId = traceId
    return this
  }

  private ipcErrorCode(): ErrorCode {
    switch (this.toolCode) {
      case 'INVALID_INPUT':
      case 'INVALID_TEMPLATE':
      case 'NOT_IMPLEMENTED':
        return 'VALIDATION_FAILED'
      case 'SECRET_MISSING':
        return 'KEYSTORE_KEY_NOT_FOUND'
      case 'NOT_FOUND':
        return 'NOT_FOUND'
      case 'ALREADY_EXISTS':
        return 'ALREADY_EXISTS'
      default:
        return 'EXECUTION_FAILED'
    }
  }
}

export function isCustomToolError(error: unknown): error is CustomToolError {
  return error instanceof CustomToolError
}
