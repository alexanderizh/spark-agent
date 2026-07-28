import { SparkError, type ErrorCode } from '@spark/shared'
import { ComputerUseBrokerError } from '../services/computer-use/ComputerUseBrokerError.js'

/** Preserves validated Computer Use codes while reusing the existing safe IPC error envelope. */
export async function safeComputerUseIpc<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof ComputerUseBrokerError) {
      // The shared transport union predates the Computer Use domain. Runtime codes are
      // schema-validated; this boundary cast avoids widening error behavior for every IPC.
      throw new SparkError(error.code as ErrorCode, error.message)
    }
    throw error
  }
}
