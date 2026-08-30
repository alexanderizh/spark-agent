import type { SdkIntegrityCheckResponse, SdkIntegrityInstallResponse } from '@spark/protocol'

export const CODEX_SDK_PACKAGE = '@openai/codex-sdk'
export const SDK_INTEGRITY_CACHE_KEY = 'spark-sdk-integrity'

let activeInstall: Promise<SdkIntegrityInstallResponse> | null = null

async function installCodexRuntime(): Promise<SdkIntegrityInstallResponse> {
  const result = await window.spark.invoke('sdk:integrity-install', {
    packageName: CODEX_SDK_PACKAGE,
  })
  if (!result.success) throw new Error(result.message)

  void window.spark
    .invoke('sdk:integrity-check', { checkLatest: false })
    .then((integrity) => {
      window.localStorage.setItem(SDK_INTEGRITY_CACHE_KEY, JSON.stringify(integrity))
    })
    .catch(() => undefined)

  return result
}

/** 全局共享的 Codex runtime 安装单例，聊天恢复卡片与 Provider 配置警示条共用，避免并发重复安装。 */
export function sharedCodexRuntimeInstall(): Promise<SdkIntegrityInstallResponse> {
  activeInstall ??= installCodexRuntime().finally(() => {
    activeInstall = null
  })
  return activeInstall
}

/** 从完整性检测结果中提取 Codex runtime 是否已安装；条目缺失或字段缺失时返回 null。 */
export function findCodexRuntimeInstalled(
  integrity: Pick<SdkIntegrityCheckResponse, 'sdks'>,
): boolean | null {
  const codex = integrity.sdks.find((sdk) => sdk.packageName === CODEX_SDK_PACKAGE)
  return codex?.runtime?.installed ?? null
}

/** 读取启动检测/安装完成后写入 localStorage 的缓存，未命中或损坏时返回 null。 */
export function readCachedCodexRuntimeInstalled(): boolean | null {
  try {
    const cached = window.localStorage.getItem(SDK_INTEGRITY_CACHE_KEY)
    if (!cached) return null
    return findCodexRuntimeInstalled(JSON.parse(cached) as SdkIntegrityCheckResponse)
  } catch {
    return null
  }
}

/** 发起一次轻量本地检测（不查最新版本）并刷新缓存，返回 Codex runtime 是否已安装。 */
export async function fetchCodexRuntimeInstalled(): Promise<boolean | null> {
  try {
    const integrity = await window.spark.invoke('sdk:integrity-check', { checkLatest: false })
    window.localStorage.setItem(SDK_INTEGRITY_CACHE_KEY, JSON.stringify(integrity))
    return findCodexRuntimeInstalled(integrity)
  } catch {
    return null
  }
}
