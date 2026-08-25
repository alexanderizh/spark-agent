import { app } from 'electron'
import type { OptionalCapabilityId, OptionalCapabilitySnapshot } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { checkSdkIntegrity as checkSdkIntegrityDefault } from '../services/SdkIntegrityService.js'
import { OptionalCapabilityManager } from '../services/optional-capabilities/OptionalCapabilityManager.js'
import type {
  SupportedDesktopArch,
  SupportedDesktopPlatform,
} from '../services/optional-capabilities/definitions.js'
import { getExternalCapabilityAdapters } from '../services/optional-capabilities/externalCapabilityAdapters.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'
import { registerVideoWorkbenchCapabilityIpc } from './registerVideoWorkbenchCapabilityIpc.js'

type Manager = Pick<
  OptionalCapabilityManager,
  'list' | 'check' | 'install' | 'update' | 'repair' | 'cancel' | 'uninstall' | 'setAutoUpdate'
>

export interface RegisterOptionalCapabilityIpcOptions {
  manager?: Manager
  checkSdkIntegrity?: typeof checkSdkIntegrityDefault
}

let managerSingleton: OptionalCapabilityManager | null = null
const log = createLogger('optional-capability-ipc')

export function getOptionalCapabilityManager(): OptionalCapabilityManager {
  managerSingleton ??= new OptionalCapabilityManager({
    userDataDir: app.getPath('userData'),
    platform: currentPlatform(),
    arch: currentArchitecture(),
    externalAdapters: getExternalCapabilityAdapters(),
    onProgress: (progress) => pushStreamEvent('stream:optional-capability:progress', progress),
  })
  return managerSingleton
}

export function registerOptionalCapabilityIpc(
  options: RegisterOptionalCapabilityIpcOptions = {},
): void {
  registerVideoWorkbenchCapabilityIpc()
  const manager = options.manager ?? getOptionalCapabilityManager()
  const checkSdkIntegrity = options.checkSdkIntegrity ?? checkSdkIntegrityDefault
  const publish = (snapshot: OptionalCapabilitySnapshot) => {
    pushStreamEvent('stream:optional-capability:snapshot', snapshot)
    return snapshot
  }
  const publishSdkIntegrityAfterRuntimeChange = async (id: OptionalCapabilityId) => {
    if (id !== 'codex-runtime') return
    try {
      const integrity = await checkSdkIntegrity({ checkLatest: false })
      pushStreamEvent('stream:sdk:integrity', integrity)
    } catch (error) {
      log.warn(`Failed to synchronize SDK integrity after Codex runtime change: ${String(error)}`)
    }
  }

  typedIpcHandle('optional-capability:list', async () => manager.list())
  typedIpcHandle('optional-capability:check', async (request) =>
    publish(await manager.check(request.forceRemote ?? false)),
  )
  registerMutation(
    'optional-capability:install',
    (id) => manager.install(id),
    publish,
    publishSdkIntegrityAfterRuntimeChange,
  )
  registerMutation(
    'optional-capability:update',
    (id) => manager.update(id),
    publish,
    publishSdkIntegrityAfterRuntimeChange,
  )
  registerMutation(
    'optional-capability:repair',
    (id) => manager.repair(id),
    publish,
    publishSdkIntegrityAfterRuntimeChange,
  )
  registerMutation(
    'optional-capability:cancel',
    (id) => manager.cancel(id),
    publish,
    publishSdkIntegrityAfterRuntimeChange,
  )
  registerMutation(
    'optional-capability:uninstall',
    (id) => manager.uninstall(id),
    publish,
    publishSdkIntegrityAfterRuntimeChange,
  )
  typedIpcHandle('optional-capability:set-auto-update', async (request) =>
    publish(await manager.setAutoUpdate(request.capabilityId, request.enabled)),
  )
}

function registerMutation(
  channel:
    | 'optional-capability:install'
    | 'optional-capability:update'
    | 'optional-capability:repair'
    | 'optional-capability:cancel'
    | 'optional-capability:uninstall',
  mutate: (id: OptionalCapabilityId) => ReturnType<OptionalCapabilityManager['install']>,
  publish: (snapshot: OptionalCapabilitySnapshot) => OptionalCapabilitySnapshot,
  onChanged: (id: OptionalCapabilityId) => Promise<void>,
): void {
  typedIpcHandle(channel, async (request) => {
    const result = await mutate(request.capabilityId)
    publish(result.snapshot)
    if (result.success) await onChanged(request.capabilityId)
    return result
  })
}

function currentPlatform(): SupportedDesktopPlatform {
  if (
    process.platform === 'darwin' ||
    process.platform === 'linux' ||
    process.platform === 'win32'
  ) {
    return process.platform
  }
  throw new Error(`Unsupported desktop platform: ${process.platform}`)
}

function currentArchitecture(): SupportedDesktopArch {
  if (process.arch === 'arm64' || process.arch === 'x64') return process.arch
  throw new Error(`Unsupported desktop architecture: ${process.arch}`)
}
