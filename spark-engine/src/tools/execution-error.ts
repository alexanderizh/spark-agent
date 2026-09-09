import { KernelError } from '../kernel/errors.js'

/** A failed tool may retain bounded diagnostics without claiming completion. */
export class ToolExecutionError extends KernelError {
  constructor(
    message: string,
    readonly output: string,
    options?: ErrorOptions,
  ) {
    const cause = options?.cause
    super(cause instanceof KernelError ? cause.code : 'tool.execution_failed', message, {
      ...(cause === undefined ? {} : { cause }),
      ...(cause instanceof KernelError ? { retryable: cause.retryable, detail: cause.detail } : {}),
    })
    this.name = 'ToolExecutionError'
  }
}
