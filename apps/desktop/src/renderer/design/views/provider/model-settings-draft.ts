import type {
  ProviderModelSettingOverrides,
  ProviderProfile,
  SessionReasoningEffort,
} from '@spark/protocol'

/**
 * 「模型设置」弹窗的纯逻辑层：分组构造 / 草稿装载 / 保存差异计算。
 *
 * 抽成不依赖 React 的模块，便于按输入矩阵单测；React 组件只负责渲染与调用 IPC。
 */

export interface ModelSettingsModelEntry {
  modelId: string
  label: string
}

export interface ModelSettingsSection {
  provider: ProviderProfile
  /** 子渠道（CLI 内置渠道的 spark 覆盖渠道）归属的父渠道名；主渠道为 undefined */
  parentProviderName?: string
  models: ModelSettingsModelEntry[]
}

/** 渠道可用模型：modelIds 优先，缺省回落 defaultModel，去重保序并丢弃空值。 */
export function listProviderModelIds(provider: ProviderProfile): string[] {
  const configured = provider.modelIds.length
    ? provider.modelIds
    : provider.defaultModel
      ? [provider.defaultModel]
      : []
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of configured) {
    const modelId = raw.trim()
    if (modelId === '' || seen.has(modelId)) continue
    seen.add(modelId)
    result.push(modelId)
  }
  return result
}

/**
 * 构造弹窗分组：每个对话渠道一组；CLI 内置渠道的 spark 覆盖子渠道各成一组
 * （挂在父渠道名之后，便于用户区分「同一个 CLI 渠道下的不同执行渠道」）。
 *
 * 多媒体 / 向量 / 路由渠道由调用方在传入前过滤（与模型选择器同一真相源）。
 */
export function buildModelSettingsSections(params: {
  conversationalProviders: ProviderProfile[]
  cliSparkProvidersByPrimaryId?: ReadonlyMap<string, ProviderProfile[]> | undefined
  resolveModelLabel?: (provider: ProviderProfile, modelId: string) => string
}): ModelSettingsSection[] {
  const { conversationalProviders, cliSparkProvidersByPrimaryId } = params
  const resolveLabel = params.resolveModelLabel ?? ((_provider, modelId) => modelId)
  const sections: ModelSettingsSection[] = []
  for (const provider of conversationalProviders) {
    const hostModels = listProviderModelIds(provider)
    if (hostModels.length > 0) {
      sections.push({
        provider,
        models: hostModels.map((modelId) => ({
          modelId,
          label: resolveLabel(provider, modelId),
        })),
      })
    }
    const sparkProviders = cliSparkProvidersByPrimaryId?.get(provider.id) ?? []
    for (const sparkProvider of sparkProviders) {
      const models = listProviderModelIds(sparkProvider)
      if (models.length === 0) continue
      sections.push({
        provider: sparkProvider,
        parentProviderName: provider.name,
        models: models.map((modelId) => ({
          modelId,
          label: resolveLabel(sparkProvider, modelId),
        })),
      })
    }
  }
  return sections
}

/** 草稿项：null / 0 / false 都表示「未覆盖 = 回落渠道级或引擎默认」。 */
export interface ModelSettingsDraftEntry {
  reasoningEffort: SessionReasoningEffort | null
  hidden: boolean
  /** 模型级上下文窗口（tokens）；0 = 未配置 */
  contextWindow: number
}

export type ModelSettingsDraft = Record<string, ModelSettingsDraftEntry>

export function modelSettingsDraftKey(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`
}

/**
 * 装载草稿：推理默认 / 显隐读 modelSettings，模型级上下文读 modelContextWindows
 * （上下文单一存储在该映射，见设计文档 §3.1）。
 */
export function buildModelSettingsDraft(sections: ModelSettingsSection[]): ModelSettingsDraft {
  const draft: ModelSettingsDraft = {}
  for (const section of sections) {
    for (const { modelId } of section.models) {
      const setting = section.provider.modelSettings?.[modelId]
      draft[modelSettingsDraftKey(section.provider.id, modelId)] = {
        reasoningEffort: setting?.reasoningEffort ?? null,
        hidden: setting?.hidden === true,
        contextWindow: section.provider.modelContextWindows?.[modelId] ?? 0,
      }
    }
  }
  return draft
}

export function isModelSettingsEntryDefault(entry: ModelSettingsDraftEntry): boolean {
  return entry.reasoningEffort == null && !entry.hidden && !(entry.contextWindow > 0)
}

/** 弹窗顶部摘要：已自定义（非默认）的模型数量。 */
export function countCustomizedModels(
  sections: ModelSettingsSection[],
  draft: ModelSettingsDraft,
): number {
  let count = 0
  for (const section of sections) {
    for (const { modelId } of section.models) {
      const entry = draft[modelSettingsDraftKey(section.provider.id, modelId)]
      if (entry != null && !isModelSettingsEntryDefault(entry)) count += 1
    }
  }
  return count
}

export interface ModelSettingsProviderUpdate {
  id: string
  /** 整表下发（键 = modelId）：未覆盖项不出现，等于「清除该模型的模型级覆盖」 */
  modelSettings: Record<string, ProviderModelSettingOverrides>
}

function entryToOverrides(entry: ModelSettingsDraftEntry): ProviderModelSettingOverrides {
  const overrides: ProviderModelSettingOverrides = {}
  if (entry.reasoningEffort != null) overrides.reasoningEffort = entry.reasoningEffort
  if (entry.hidden) overrides.hidden = true
  if (entry.contextWindow > 0) overrides.contextWindow = entry.contextWindow
  return overrides
}

/**
 * 计算保存载荷：仅返回有实际改动的渠道；每个渠道下发**完整**的 modelSettings 表
 * （provider:update 对该字段是整表替换语义，缺项即清除，避免误删未改动模型的覆盖）。
 *
 * 上下文窗口同样放在 modelSettings 里下发：服务层会拆写进 modelContextWindows
 * （单一存储），因此这里无需单独下发 modelContextWindows。
 */
export function buildModelSettingsUpdates(
  sections: ModelSettingsSection[],
  draft: ModelSettingsDraft,
): ModelSettingsProviderUpdate[] {
  const updates: ModelSettingsProviderUpdate[] = []
  const visited = new Set<string>()
  for (const section of sections) {
    const providerId = section.provider.id
    if (visited.has(providerId)) continue
    visited.add(providerId)
    let changed = false
    const modelSettings: Record<string, ProviderModelSettingOverrides> = {}
    for (const { modelId } of section.models) {
      const entry = draft[modelSettingsDraftKey(providerId, modelId)]
      if (entry == null) continue
      const setting = section.provider.modelSettings?.[modelId]
      const original: ModelSettingsDraftEntry = {
        reasoningEffort: setting?.reasoningEffort ?? null,
        hidden: setting?.hidden === true,
        contextWindow: section.provider.modelContextWindows?.[modelId] ?? 0,
      }
      const hadOverride = !isModelSettingsEntryDefault(original)
      if (
        original.reasoningEffort !== entry.reasoningEffort ||
        original.hidden !== entry.hidden ||
        original.contextWindow !== entry.contextWindow
      ) {
        changed = true
      }
      // 有覆盖、或原本有覆盖而现在被重置的模型都要出现在整表里：
      // 后者以空对象表达「清除」，服务层据此删掉该模型的模型级上下文窗口
      // （遗漏会让「恢复默认」变得无效）。从未配置过的模型不出现在载荷中。
      if (hadOverride || !isModelSettingsEntryDefault(entry)) {
        modelSettings[modelId] = entryToOverrides(entry)
      }
    }
    if (changed) updates.push({ id: providerId, modelSettings })
  }
  return updates
}
