import { SparkError, type ErrorCode } from '@spark/shared'
import { ComputerUseBrokerError } from '../services/computer-use/ComputerUseBrokerError.js'
import type { ComputerUseDiagnostic } from '../services/computer-use/ComputerUseDiagnostic.js'
import { NativeHostArtifactError } from '../services/computer-use/NativeHostArtifact.js'

/** Preserves validated Computer Use codes while reusing the existing safe IPC error envelope. */
export async function safeComputerUseIpc<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ComputerUseBrokerError || error instanceof NativeHostArtifactError) {
      // The shared transport union predates the Computer Use domain. Runtime codes are
      // schema-validated; this boundary cast avoids widening error behavior for every IPC.
      // Structured diagnostics (fine-grained diagnosticCode, pipeline stage, actionable
      // repairAction) and the retryable flag ride on `context` so the renderer / agent can
      // surface a precise, recoverable cause instead of a single coarse internal code.
      throw new SparkError(error.code as ErrorCode, error.message, buildErrorContext(error))
    }
    throw error
  }
}

function buildErrorContext(error: {
  diagnostic?: ComputerUseDiagnostic | undefined
  retryable?: boolean | undefined
}): Record<string, unknown> | undefined {
  const context: Record<string, unknown> = {}
  if (error.diagnostic !== undefined) {
    context.diagnostic = error.diagnostic
  }
  if (error.retryable === true) {
    context.retryable = true
  }
  return Object.keys(context).length > 0 ? context : undefined
}
