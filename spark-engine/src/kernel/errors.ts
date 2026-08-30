import type { ErrorInfo } from '../events/schema.js';

export class KernelError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly detail?: unknown;

  constructor(
    code: string,
    message: string,
    options: { readonly retryable?: boolean; readonly detail?: unknown; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'KernelError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.detail !== undefined) this.detail = options.detail;
  }
}

export function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof KernelError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
    };
  }
  if (error instanceof Error) {
    return {
      code: 'kernel.unexpected',
      message: error.message,
      retryable: false,
      detail: { name: error.name },
    };
  }
  return { code: 'kernel.unexpected', message: String(error), retryable: false };
}
