import { createLogger } from '@spark/shared'
import type { OptionalCapabilityManager } from '../services/optional-capabilities/OptionalCapabilityManager.js'
import { checkSdkIntegrity, installSdk } from '../services/SdkIntegrityService.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'

type CapabilityManager = Pick<OptionalCapabilityManager, 'list'>

export interface RegisterSdkIntegrityIpcOptions {
  capabilityManager: CapabilityManager
  checkIntegrity?: typeof checkSdkIntegrity
  install?: typeof installSdk
}

const log = createLogger('sdk-integrity-ipc')

export function registerSdkIntegrityIpc(options: RegisterSdkIntegrityIpcOptions): void {
  const checkIntegrity = options.checkIntegrity ?? checkSdkIntegrity
  const install = options.install ?? installSdk

  typedIpcHandle('sdk:integrity-check', async (request) => {
    log.info(`sdk:integrity-check requested, checkLatest=${request.checkLatest ?? false}`)
    return checkIntegrity(request)
  })

  typedIpcHandle('sdk:integrity-install', async (request) => {
    log.info(`sdk:integrity-install requested, packageName=${request.packageName}`)
    const result = await install(request.packageName, (progress) => {
      pushStreamEvent('stream:sdk:install-progress', progress)
    })
    if (result.success && request.packageName === '@openai/codex-sdk') {
      await publishCodexRuntimeSnapshots(options.capabilityManager, checkIntegrity)
    }
    return result
  })
}

async function publishCodexRuntimeSnapshots(
  capabilityManager: CapabilityManager,
  checkIntegrity: typeof checkSdkIntegrity,
): Promise<void> {
  try {
    const integrity = await checkIntegrity({ checkLatest: false })
    pushStreamEvent('stream:sdk:integrity', integrity)
  } catch (error) {
    log.warn(`Failed to refresh SDK integrity after Codex runtime install: ${String(error)}`)
  }

  try {
    // 只重读本地激活状态；`check()` 可能在缓存过期时联网并触发其他组件自动更新。
    const snapshot = await capabilityManager.list()
    pushStreamEvent('stream:optional-capability:snapshot', snapshot)
  } catch (error) {
    log.warn(
      `Failed to refresh optional capabilities after Codex runtime install: ${String(error)}`,
    )
  }
}
