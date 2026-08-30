import { isAutoRouterProvider, type ProviderProfile } from '@spark/protocol'

/**
 * Auto Router 的运行时能力暂时保留，仅从应用界面隐藏。
 * 恢复入口时只需切换此开关，不必迁移现有 Provider 或模型卡数据。
 */
export const AUTO_ROUTER_UI_VISIBLE = false

export function isProviderVisibleInUi(provider: ProviderProfile): boolean {
  return AUTO_ROUTER_UI_VISIBLE || !isAutoRouterProvider(provider)
}

export function filterProvidersForVisibleUi<T extends ProviderProfile>(
  providers: readonly T[],
): T[] {
  return providers.filter(isProviderVisibleInUi)
}
