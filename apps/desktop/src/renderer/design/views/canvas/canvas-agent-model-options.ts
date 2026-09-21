import type { ProviderProfile, SessionAgentAdapter } from '@spark/protocol'
import { AUTO_ROUTER_PROVIDER_TYPE } from '@spark/protocol'
import { getProviderAdapterKind } from '../../utils/provider-adapter'

export interface CanvasAgentModelGroup {
  provider: ProviderProfile
  adapter: SessionAgentAdapter
  models: Array<{ modelId: string; label: string }>
}

export interface CanvasAgentModelSelection {
  provider: ProviderProfile | null
  providerId: string
  modelId: string
  adapter: SessionAgentAdapter
}

export function isCanvasAgentConversationProvider(provider: ProviderProfile): boolean {
  return (
    provider.modelType !== 'image' &&
    provider.modelType !== 'voice' &&
    provider.modelType !== 'video'
  )
}

export function filterCanvasAgentConversationProviders(
  providers: ProviderProfile[],
): ProviderProfile[] {
  return providers.filter(isCanvasAgentConversationProvider)
}

/** AutoRouter 行：执行模型由分流器逐轮决定，自身 modelIds 恒空（Phase 4 画布接入）。 */
export function isCanvasAgentAutoRouter(provider: ProviderProfile | undefined): boolean {
  return provider?.providerType === AUTO_ROUTER_PROVIDER_TYPE
}

/**
 * router 的「模型」不是可选项而是一个说明性条目：选中它 = 由分流器逐轮决定执行模型
 * （modelId 恒空，与 Composer / 会话侧口径一致）。
 */
export const CANVAS_AUTO_ROUTER_MODEL_LABEL = '智能路由（由分流器决定执行模型）'

export function getCanvasAgentProviderModels(provider: ProviderProfile | undefined): string[] {
  if (provider == null) return []
  // router 无固定模型清单：不返回 defaultModel/modelIds（即便存量行有残留值也不展示）
  if (isCanvasAgentAutoRouter(provider)) return []
  return Array.from(
    new Set(
      [
        provider.defaultModel,
        provider.haikuModel,
        provider.sonnetModel,
        provider.opusModel,
        ...provider.modelIds,
      ]
        .map((model) => model?.trim())
        .filter((model): model is string => Boolean(model)),
    ),
  )
}

export function buildCanvasAgentModelOptions(
  providers: ProviderProfile[],
): CanvasAgentModelGroup[] {
  return filterCanvasAgentConversationProviders(providers)
    .map((provider) => ({
      provider,
      adapter: getProviderAdapterKind(provider),
      models: isCanvasAgentAutoRouter(provider)
        ? // router 行 modelIds 恒空，用单条说明性条目占位，避免被下方长度过滤丢弃
          // （否则画布 agent 根本选不到 router，Phase 4 「入口闭环」形同虚设）。
          [{ modelId: '', label: CANVAS_AUTO_ROUTER_MODEL_LABEL }]
        : getCanvasAgentProviderModels(provider).map((modelId) => ({
            modelId,
            label: modelId,
          })),
    }))
    .filter((group) => group.models.length > 0)
}

export function resolveCanvasAgentProviderModel(
  provider: ProviderProfile,
  preferredModelId: string | undefined,
): string {
  // router：modelId 恒空（分流器决定执行模型），任何残留的旧 modelId 都不得带过去
  if (isCanvasAgentAutoRouter(provider)) return ''
  const models = getCanvasAgentProviderModels(provider)
  return preferredModelId != null && models.includes(preferredModelId)
    ? preferredModelId
    : (provider.defaultModel ?? models[0] ?? '')
}

export function resolveCanvasAgentModelSelection({
  providers,
  providerId,
  modelId,
  fallbackAdapter,
}: {
  providers: ProviderProfile[]
  providerId: string
  modelId: string
  fallbackAdapter: SessionAgentAdapter
}): CanvasAgentModelSelection {
  const provider = providers.find((item) => item.id === providerId) ?? null
  const adapter = provider != null ? getProviderAdapterKind(provider) : fallbackAdapter
  return {
    provider,
    providerId,
    modelId: provider != null ? resolveCanvasAgentProviderModel(provider, modelId) : modelId,
    adapter,
  }
}
