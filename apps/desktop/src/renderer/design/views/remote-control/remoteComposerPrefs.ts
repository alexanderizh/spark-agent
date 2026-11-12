/**
 * 「上次用的助手 / 模型 / 权限」→ 目标端 PATCH 包（纯函数，便于单测）。
 *
 * 目标端不会替我们校验记忆里的旧值：用户可能在另一台机器上删了某个渠道、
 * 换过 adapter，直接把记忆原样 PATCH 过去会变成「新建会话即报错」。
 * 所以套用之前先按当前目录收敛一遍：
 *   - agentId 必须在目录里；
 *   - 渠道 + 模型必须成对存在（AutoRouter 之类不可手选的渠道压根不在目录里）；
 *   - permissionMode 必须被**选中助手所属 adapter** 允许（未带助手时要求任意
 *     adapter 允许即可），与目标端权限面板的过滤口径一致；
 *   - reasoningEffort 必须在目录枚举里（与 adapter 无关）。
 * 目录缺失（旧版目标端没有 /v1/catalog）时一律不套用，不猜。
 */
import type { MobileBridgeCatalog } from '@spark/protocol'
import type { RemoteComposerPrefs } from './remoteViewState'

export interface RemoteComposerPrefsPatch {
  agentId?: string
  providerProfileId?: string
  modelId?: string | null
  permissionMode?: string
  reasoningEffort?: string
}

/** 权限档在给定 adapter 下是否合法；adapter 未知时退化为「任意 adapter 允许」 */
export function isPermissionModeAllowed(
  catalog: MobileBridgeCatalog,
  mode: string,
  adapter?: string | null,
): boolean {
  const modes = catalog.permissionModes ?? {}
  const adapterModes = adapter != null ? modes[adapter] : undefined
  if (Array.isArray(adapterModes)) return adapterModes.includes(mode)
  return Object.values(modes).some((list) => Array.isArray(list) && list.includes(mode))
}

export function resolveComposerPrefsPatch(
  prefs: RemoteComposerPrefs | null,
  catalog: MobileBridgeCatalog | null,
): RemoteComposerPrefsPatch {
  if (prefs == null || catalog == null) return {}
  const patch: RemoteComposerPrefsPatch = {}

  const agent =
    prefs.agentId != null ? (catalog.agents ?? []).find((item) => item.id === prefs.agentId) : null
  if (agent != null) patch.agentId = agent.id

  const providerProfileId = prefs.providerProfileId
  const modelId = prefs.modelId
  if (providerProfileId != null && modelId === null) {
    const provider = (catalog.providers ?? []).find((item) => item.id === providerProfileId)
    if (provider != null && (provider.isAutoRouter || provider.models.length === 0)) {
      patch.providerProfileId = providerProfileId
      patch.modelId = null
    }
  } else if (providerProfileId != null && modelId != null) {
    const provider = (catalog.providers ?? []).find((item) => item.id === providerProfileId)
    if (provider != null && provider.models.some((model) => model.id === modelId)) {
      patch.providerProfileId = providerProfileId
      patch.modelId = modelId
    }
  }

  if (prefs.permissionMode != null) {
    // 换了助手就按新助手的 adapter 校验；没有助手用任意 adapter 允许即可
    const adapter = agent?.agentAdapter ?? null
    if (isPermissionModeAllowed(catalog, prefs.permissionMode, adapter)) {
      patch.permissionMode = prefs.permissionMode
    }
  }

  if (prefs.reasoningEffort != null) {
    // 推理档位与 adapter 无关（由 agent-runtime 各自映射），只要在目录枚举里就套用
    const efforts = catalog.reasoningEfforts ?? []
    if (efforts.includes(prefs.reasoningEffort)) patch.reasoningEffort = prefs.reasoningEffort
  }

  return patch
}

/** 从会话生效配置里抽一份可记忆的偏好（丢弃空值） */
export function prefsFromRuntime(
  runtime: {
    agentId?: string | null
    providerProfileId?: string
    modelId?: string | null
    permissionMode?: string
    reasoningEffort?: string
  } | null,
): RemoteComposerPrefs {
  const prefs: RemoteComposerPrefs = {}
  if (runtime?.agentId != null && runtime.agentId !== '') prefs.agentId = runtime.agentId
  if (runtime?.providerProfileId != null && runtime.providerProfileId !== '') {
    prefs.providerProfileId = runtime.providerProfileId
  }
  if (runtime?.modelId === null) prefs.modelId = null
  else if (runtime?.modelId != null && runtime.modelId !== '') prefs.modelId = runtime.modelId
  if (runtime?.permissionMode != null && runtime.permissionMode !== '') {
    prefs.permissionMode = runtime.permissionMode
  }
  if (runtime?.reasoningEffort != null && runtime.reasoningEffort !== '') {
    prefs.reasoningEffort = runtime.reasoningEffort
  }
  return prefs
}
