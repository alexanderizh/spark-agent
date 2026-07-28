import type { ComputerUseErrorCode } from '@spark/protocol'

export class ComputerUseBrokerError extends Error {
  readonly code: ComputerUseErrorCode
  readonly details: Readonly<Record<string, string>> | undefined

  constructor(
    code: ComputerUseErrorCode,
    message: string,
    details?: Readonly<Record<string, string>>,
  ) {
    super(message)
    this.name = 'ComputerUseBrokerError'
    this.code = code
    this.details = details
  }
}
