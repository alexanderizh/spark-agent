import {
  AppControlCommandRequestSchema,
  AppControlCommandResultSchema,
  type AppControlCommand,
  type AppControlCommandRequest,
  type AppControlCommandResult,
} from '@spark/protocol'
import { randomUUID } from 'node:crypto'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

interface PendingCommand {
  request: AppControlCommandRequest
  resolve(result: AppControlCommandResult): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  removeAbortListener(): void
}

export interface AppControlBridgeTransport {
  send(request: AppControlCommandRequest): boolean
}

/**
 * Session-bound, allowlisted command bridge to SparkWork's trusted top-level renderer.
 * It intentionally exposes no generic selector, script, eval, URL, or arbitrary IPC command.
 */
export class AppControlBridge {
  private readonly pending = new Map<string, PendingCommand>()

  constructor(
    private readonly transport: AppControlBridgeTransport,
    private readonly createId: () => string = randomUUID,
    private readonly timeoutMs = 5_000,
  ) {}

  execute(input: {
    computerSessionId: string
    actionId: string
    command: AppControlCommand
    signal: AbortSignal
  }): Promise<AppControlCommandResult> {
    if (input.signal.aborted) return Promise.reject(sessionCanceled())
    const request = AppControlCommandRequestSchema.parse({
      commandId: this.createId(),
      computerSessionId: input.computerSessionId,
      actionId: input.actionId,
      command: input.command,
    })
    return new Promise((resolve, reject) => {
      const abort = (): void => this.rejectPending(request.commandId, sessionCanceled())
      input.signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(
        () =>
          this.rejectPending(
            request.commandId,
            new ComputerUseBrokerError('action_timeout', 'SparkWork app command timed out'),
          ),
        this.timeoutMs,
      )
      timer.unref()
      this.pending.set(request.commandId, {
        request,
        resolve,
        reject,
        timer,
        removeAbortListener: () => input.signal.removeEventListener('abort', abort),
      })
      let sent = false
      try {
        sent = this.transport.send(request)
      } catch {
        sent = false
      }
      if (!sent) {
        this.rejectPending(
          request.commandId,
          new ComputerUseBrokerError(
            'environment_unavailable',
            'Trusted SparkWork renderer is unavailable',
          ),
        )
      }
    })
  }

  resolve(rawResult: AppControlCommandResult): boolean {
    const result = AppControlCommandResultSchema.parse(rawResult)
    const pending = this.pending.get(result.commandId)
    if (
      pending == null ||
      pending.request.computerSessionId !== result.computerSessionId ||
      pending.request.actionId !== result.actionId
    ) {
      return false
    }
    this.clearPending(result.commandId, pending)
    if (result.status === 'rejected') {
      pending.reject(
        new ComputerUseBrokerError('action_noop', 'SparkWork rejected the app command'),
      )
    } else {
      pending.resolve(result)
    }
    return true
  }

  cancelSession(computerSessionId: string): void {
    for (const [commandId, pending] of this.pending) {
      if (pending.request.computerSessionId === computerSessionId) {
        this.rejectPending(commandId, sessionCanceled())
      }
    }
  }

  private rejectPending(commandId: string, error: Error): void {
    const pending = this.pending.get(commandId)
    if (pending == null) return
    this.clearPending(commandId, pending)
    pending.reject(error)
  }

  private clearPending(commandId: string, pending: PendingCommand): void {
    this.pending.delete(commandId)
    clearTimeout(pending.timer)
    pending.removeAbortListener()
  }
}

function sessionCanceled(): ComputerUseBrokerError {
  return new ComputerUseBrokerError('session_canceled', 'Computer session is canceled')
}
