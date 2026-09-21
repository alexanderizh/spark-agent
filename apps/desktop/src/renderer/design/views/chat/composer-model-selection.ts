import { AUTO_ROUTER_PROVIDER_TYPE, type ProviderProfile } from '@spark/protocol'

type ComposerProviderSelection = Pick<ProviderProfile, 'providerType' | 'autoRouterConfig'>

/**
 * 普通模型通过 modelId 表示可执行目标；Autorouter 则由路由配置决定每轮执行模型，
 * 因此它的 modelId 按协议必须为空。
 */
export function hasExecutableComposerModel(
  provider: ComposerProviderSelection | null | undefined,
  modelId: string,
): boolean {
  if (modelId.trim().length > 0) return true
  return provider?.providerType === AUTO_ROUTER_PROVIDER_TYPE && provider.autoRouterConfig != null
}
