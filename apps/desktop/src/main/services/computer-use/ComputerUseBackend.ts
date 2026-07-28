import type {
  ComputerActionEnvelope,
  ComputerObservation,
  ComputerUseCapabilitySummary,
  NativeHostPlatform,
  NativeWindowDescriptor,
} from '@spark/protocol'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

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
  }): Promise<{ observation: ComputerObservation; noop: boolean }>
  cancelSession(computerSessionId: string): Promise<void>
}

export interface ComputerHostBackend {
  getCapabilities(): Promise<ComputerUseCapabilitySummary>
  listWindows(): Promise<NativeWindowDescriptor[]>
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
