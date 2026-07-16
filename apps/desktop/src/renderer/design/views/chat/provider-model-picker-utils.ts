import {
  LOCAL_CLI_DEFAULT_MODEL,
  LOCAL_CLI_PROVIDER_ID,
  LOCAL_CODEX_CLI_DEFAULT_MODEL,
  LOCAL_CODEX_CLI_PROVIDER_ID,
  isBuiltInLocalCliProvider,
  type ProviderProfile,
  type VendorMeta,
} from '@spark/protocol'

const SPARK_PLATFORM_VENDOR: VendorMeta = {
  id: 'spark-platform',
  name: 'Spark 平台模型',
  emoji: 'SP',
  color: '#ffffff',
  desc: '',
  logoPath: 'providers/spark-platform.png',
}

export function resolveManagedPlatformVendor(
  provider: ProviderProfile | null | undefined,
): VendorMeta | null {
  return provider?.managed === true ? SPARK_PLATFORM_VENDOR : null
}

export function prioritizeManagedProviderGroups<T extends { provider: ProviderProfile }>(
  groups: T[],
): T[] {
  return [...groups].sort(
    (left, right) => Number(right.provider.managed === true) - Number(left.provider.managed === true),
  )
}

export function getProviderPickerLogoSize(provider: ProviderProfile): number {
  return provider.managed === true ? 18 : 14
}

/**
 * 只保留当前 Provider 确实可用的模型。
 *
 * Provider 列表在登出/配置刷新后会变化；不能把旧会话或本地偏好中的模型 ID
 * 原样挂到新的 Provider 上，否则选择器会继续显示已经不可用的平台专属模型。
 */
export function resolveAvailableProviderModel(
  modelId: string | null | undefined,
  provider: ProviderProfile | null | undefined,
): string {
  const model = modelId?.trim() ?? ''
  if (isBuiltInLocalCliProvider(provider)) {
    if (model) return model
    if (provider?.id === LOCAL_CODEX_CLI_PROVIDER_ID) return LOCAL_CODEX_CLI_DEFAULT_MODEL
    if (provider?.id === LOCAL_CLI_PROVIDER_ID) return LOCAL_CLI_DEFAULT_MODEL
    return provider?.defaultModel || ''
  }
  if (!model || provider == null) return ''
  const configuredModels = provider.modelIds.length
    ? provider.modelIds
    : provider.defaultModel
      ? [provider.defaultModel]
      : []
  if (configuredModels.length === 0) return model
  return configuredModels.includes(model) ? model : ''
}
