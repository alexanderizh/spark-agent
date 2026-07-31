import type { ComputerActionEnvelope, ComputerObservation } from '@spark/protocol'
import type { ComputerExecutorBackend, ComputerObserverBackend } from './ComputerUseBackend.js'
import type { AppControlBridge } from './AppControlBridge.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

export class AppControlExecutorBackend implements ComputerExecutorBackend {
  constructor(
    private readonly nativeExecutor: ComputerExecutorBackend,
    private readonly observer: ComputerObserverBackend,
    private readonly bridge: Pick<AppControlBridge, 'execute' | 'cancelSession'>,
    private readonly ownAppIds: ReadonlySet<string>,
  ) {}

  async execute(input: {
    envelope: ComputerActionEnvelope
    observation: ComputerObservation
    signal: AbortSignal
  }): Promise<{ observation: ComputerObservation; noop: boolean }> {
    if (input.envelope.action.type !== 'app_command') {
      return this.nativeExecutor.execute(input)
    }
    if (!this.ownAppIds.has(input.envelope.targetAppId)) {
      throw new ComputerUseBrokerError(
        'action_not_allowed',
        'App commands are restricted to SparkWork itself',
      )
    }
    await this.bridge.execute({
      computerSessionId: input.envelope.computerSessionId,
      actionId: input.envelope.actionId,
      command: input.envelope.action.command,
      signal: input.signal,
    })
    const observation = await this.observer.observe({
      computerSessionId: input.envelope.computerSessionId,
      fullTree: true,
      signal: input.signal,
    })
    return { observation, noop: false }
  }

  async cancelSession(computerSessionId: string): Promise<void> {
    this.bridge.cancelSession(computerSessionId)
    await this.nativeExecutor.cancelSession(computerSessionId)
  }
}
