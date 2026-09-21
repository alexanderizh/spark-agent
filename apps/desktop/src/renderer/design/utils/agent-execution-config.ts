import type { ProviderProfile, SessionAgentAdapter } from '@spark/protocol'
import { AUTO_ROUTER_PROVIDER_TYPE, isBuiltInLocalCliProvider } from '@spark/protocol'
import { getProviderAdapterKind } from './provider-adapter'

function isAutoRouterProfile(
  provider: ProviderProfile | null | undefined,
): boolean {
  return provider?.providerType === AUTO_ROUTER_PROVIDER_TYPE
}

export function getLockedAgentAdapterForProvider(
  provider: ProviderProfile | null | undefined,
): SessionAgentAdapter | null {
  // router 行的引擎按其声明（autoRouterConfig.adapter），不按 provider 字段推断
  if (isAutoRouterProfile(provider)) {
    return provider?.autoRouterConfig?.adapter === 'codex' ? 'codex' : 'claude-sdk'
  }
  return provider ? getProviderAdapterKind(provider) : null
}

export function shouldAllowAgentModelOverride(
  provider: ProviderProfile | null | undefined,
): boolean {
  // router 的执行模型由分流器逐轮决定，agent 不单独覆盖模型
  if (isAutoRouterProfile(provider)) return false
  return provider != null && !isBuiltInLocalCliProvider(provider)
}

export function getProviderModelOptions(provider: ProviderProfile | null | undefined): string[] {
  if (provider == null) return []
  const models = provider.modelIds.length > 0 ? provider.modelIds : [provider.defaultModel]
  return Array.from(new Set(models.filter((model) => model.trim().length > 0)))
}

export function getDefaultAgentModelForProvider(
  provider: ProviderProfile | null | undefined,
): string {
  if (provider == null || !shouldAllowAgentModelOverride(provider)) return ''
  return provider.defaultModel || provider.modelIds[0] || ''
}

export function normalizeAgentModelForProvider(
  provider: ProviderProfile | null | undefined,
  modelId: string,
): string {
  if (provider == null) return modelId
  if (!shouldAllowAgentModelOverride(provider)) return ''
  if (!modelId) return ''
  return modelId
}
