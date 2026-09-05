import type {
  ComputerActionEnvelope,
  ComputerExecutionChannel,
  ComputerObservation,
  ComputerUseCapabilitySummary,
  NativeHostCapabilityManifest,
  NativeHostPlatform,
  NativeWindowDescriptor,
} from '@spark/protocol'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { ComputerUseDiagnostic } from './ComputerUseDiagnostic.js'

export interface NativeHostDiagnosticProbe {
  readonly capabilities: ComputerUseCapabilitySummary
  readonly diagnostic: ComputerUseDiagnostic
  readonly errorCode: string | null
  readonly message: string
}

export interface ComputerObserverBackend {
  observe(input: {
    computerSessionId: string
    fullTree: boolean
    signal: AbortSignal
  }): Promise<ComputerObservation>
}

export interface ComputerExecutorBackend {
  execute(input: {
    envelope: ComputerActionEnvelope
    observation: ComputerObservation
    signal: AbortSignal
  }): Promise<{
    observation: ComputerObservation
    noop: boolean
    /** Which transport executed the action, when the backend can tell (native host). */
    executionChannel?: ComputerExecutionChannel | null
  }>
  cancelSession(computerSessionId: string): Promise<void>
}

export interface ComputerHostBackend {
  getCapabilities(): Promise<ComputerUseCapabilitySummary>
  diagnoseNativeHost?(): Promise<NativeHostDiagnosticProbe>
  requestPermissions?(
    permissions: Array<'screen' | 'accessibility'>,
  ): Promise<NativeHostCapabilityManifest>
  listWindows(): Promise<NativeWindowDescriptor[]>
  inspectWindow?(input: {
    appId: string
    windowId: string
    fullTree: boolean
    signal?: AbortSignal
  }): Promise<ComputerObservation>
  bindSessionTarget?(input: { computerSessionId: string; appId: string; windowId: string }): void
}

export class UnavailableComputerUseBackend
  implements ComputerObserverBackend, ComputerExecutorBackend, ComputerHostBackend
{
  async getCapabilities(): Promise<ComputerUseCapabilitySummary> {
    return {
      available: false,
      platform: currentNativeHostPlatform(),
      nativeHost: null,
      permissions: {
        screen: 'unsupported',
        accessibility: 'unsupported',
        input: 'unsupported',
      },
      unavailableReason: 'trusted_native_host_missing',
    }
  }

  async diagnoseNativeHost(): Promise<NativeHostDiagnosticProbe> {
    return {
      capabilities: await this.getCapabilities(),
      diagnostic: {
        diagnosticCode: 'native_host_missing',
        stage: 'discover',
        repairAction: 'reinstall',
      },
      errorCode: 'native_host_missing',
      message: 'A trusted Computer Use native backend is not installed',
    }
  }

  async listWindows(): Promise<NativeWindowDescriptor[]> {
    throw nativeHostMissing()
  }

  async observe(): Promise<ComputerObservation> {
    throw nativeHostMissing()
  }

  async execute(): Promise<{ observation: ComputerObservation; noop: boolean }> {
    throw nativeHostMissing()
  }

  async cancelSession(): Promise<void> {}
}

export function currentNativeHostPlatform(platform = process.platform): NativeHostPlatform {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  return 'linux'
}

function nativeHostMissing(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'native_host_missing',
    'A trusted Computer Use native backend is not installed',
  )
}
