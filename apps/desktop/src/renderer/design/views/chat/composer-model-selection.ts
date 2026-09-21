import type { ProviderProfile, SessionAgentAdapter } from '@spark/protocol'
import { AUTO_ROUTER_PROVIDER_TYPE } from '@spark/protocol'
import { isProviderCompatibleWithAdapter } from '../../utils/provider-adapter'

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

export interface ComposerModelVisibilityInput {
  providers: ProviderProfile[]
  /**
   * 模型可见性的引擎上下文：
   * - `null` 表示空会话草稿——尚无引擎承诺，全部对话渠道与启用路由可见，
   *   选中任意项后由 handleProviderModelChange 校准草稿引擎（「选中即校准」机制）。
   * - 历史会话传 `session.agentAdapter`，按会话自身的引擎配置判定可见性
   *   （与运行时兼容判定 isProviderCompatibleWithAdapter 同一真相源）。
   */
  filterAdapter: SessionAgentAdapter | null
  /**
   * 历史会话当前绑定的 provider id（含 router 行）。绑定项无条件保留可见：
   * 绑定与会话引擎不一致（历史数据、引擎被重置等）时，隐藏绑定项会导致
   * 选中态回落到默认渠道并被自动同步改绑，破坏「按历史配置判断」。
   */
  boundProviderId?: string | null | undefined
}

export interface ComposerModelVisibility {
  /** 普通渠道分组（排除路由与多媒体生成渠道），按场景过滤后的可见列表。 */
  conversationalProviders: ProviderProfile[]
  /** 「智能路由」分组的可见列表（仅启用中的 router 行）。 */
  autoRouterProviders: ProviderProfile[]
}

export function resolveComposerModelVisibility(
  input: ComposerModelVisibilityInput,
): ComposerModelVisibility {
  const { providers, filterAdapter, boundProviderId } = input
  const isBound = (provider: ProviderProfile): boolean =>
    boundProviderId != null && boundProviderId.length > 0 && provider.id === boundProviderId
  const isVisible = (provider: ProviderProfile): boolean =>
    filterAdapter == null || isBound(provider) || isProviderCompatibleWithAdapter(provider, filterAdapter)
  return {
    conversationalProviders: providers.filter(
      (provider) =>
        provider.providerType !== AUTO_ROUTER_PROVIDER_TYPE &&
        provider.modelType !== 'image' &&
        provider.modelType !== 'voice' &&
        provider.modelType !== 'video' &&
        isVisible(provider),
    ),
    autoRouterProviders: providers.filter(
      (provider) =>
        provider.providerType === AUTO_ROUTER_PROVIDER_TYPE &&
        provider.enabled !== false &&
        isVisible(provider),
    ),
  }
}
