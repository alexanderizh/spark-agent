import type { ProviderProfile } from '@spark/protocol'
import { AUTO_ROUTER_PROVIDER_TYPE } from '@spark/protocol'
import {
  isEmbeddingProviderProfile,
  isMediaProviderProfile,
} from '../../utils/provider-model-kind'

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
}

export interface ComposerModelVisibility {
  /** 普通渠道分组（排除路由、多媒体生成渠道与向量渠道）。 */
  conversationalProviders: ProviderProfile[]
  /** 「智能路由」分组的可见列表（仅启用中的 router 行）。 */
  autoRouterProviders: ProviderProfile[]
  /**
   * 在「模型设置」中被隐藏的模型键（`${providerId}:${modelId}`）。
   *
   * 只在选择器渲染层过滤：`provider:list` 数据保持完整，已选中被隐藏模型的会话
   * 继续可用（与 modelSchedules 定时禁用的读取侧剔除语义不同，见设计文档 §2.3）。
   */
  hiddenModelKeys: Set<string>
}

export function composerModelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
}

/** 模型是否在模型选择器中被隐藏（hiddenModelKeys 由 resolveComposerModelVisibility 产出）。 */
export function isComposerModelHidden(
  hiddenModelKeys: ReadonlySet<string>,
  providerId: string,
  modelId: string,
): boolean {
  return hiddenModelKeys.has(composerModelKey(providerId, modelId))
}

/**
 * 模型选择器的显示/分组规则（单一真相源，含单测矩阵）。
 *
 * 不按会话引擎过滤：历史会话与空会话一致展示全部对话渠道与启用路由，
 * 选中任意渠道/路由即由 handleProviderModelChange 校准会话引擎（含
 * agentAdapter 与权限模式持久化）。跨引擎切换后上下文不丢——resume 失配
 * 时由 recovery 兜底组装（continuity capsule + 精确近期历史）注入新引擎，
 * 见 conversation-summarizer 的 recoveryPrompt 与执行器 resumeFallback 链路。
 *
 * 本函数只负责：多媒体生成渠道与向量（Embeddings）渠道过滤、router 行独立分组、
 * 停用路由剔除、隐藏模型键汇总（hiddenModelKeys，供渲染层剔除）。
 */
export function resolveComposerModelVisibility(
  input: ComposerModelVisibilityInput,
): ComposerModelVisibility {
  const { providers } = input
  const hiddenModelKeys = new Set<string>()
  for (const provider of providers) {
    const settings = provider.modelSettings
    if (settings == null) continue
    for (const [modelId, setting] of Object.entries(settings)) {
      if (setting?.hidden === true) hiddenModelKeys.add(composerModelKey(provider.id, modelId))
    }
  }
  return {
    conversationalProviders: providers.filter(
      (provider) =>
        provider.providerType !== AUTO_ROUTER_PROVIDER_TYPE &&
        !isMediaProviderProfile(provider) &&
        !isEmbeddingProviderProfile(provider),
    ),
    autoRouterProviders: providers.filter(
      (provider) =>
        provider.providerType === AUTO_ROUTER_PROVIDER_TYPE && provider.enabled !== false,
    ),
    hiddenModelKeys,
  }
}
