/**
 * provider-delete-cascade — 渠道删除的级联重绑（「设置不同步」类故障的根因修复）。
 *
 * 删除渠道此前只删行与密钥，不处理任何引用方：绑定该渠道的会话在下一轮 turn
 * 直接报「Provider profile not found」，远程连接的 defaultProviderProfileId
 * 悬空后新建会话误报「没有可用 Provider」。用户在远程（Telegram 等）看到的
 * 就是一串无指引的失败。这里在删除落库后把引用方收敛到可用状态：
 * - 会话：重绑到「默认对话渠道」（无默认位则第一个对话渠道），模型尽量沿用，
 *   沿用不了（新渠道没有该模型）时落新渠道默认模型；引擎与新渠道协议不匹配时
 *   一并校准（否则重绑本身就制造 codex×Anthropic / claude×OpenAI 的守卫冲突）。
 *   没有任何对话渠道时保持原状，由 turn 起点的中文报错引导用户手动选择。
 * - 远程连接默认值：由 RemoteConnectionService.clearDeletedProviderReferences 清理。
 *
 * 重绑候选只认「对话渠道」（多媒体生成/向量渠道不能承接文本 turn，与渲染端
 * isConversationalProviderCandidate 同口径），且不含 AutoRouter 行——重绑是
 * 兜底动作，不应引入分流语义。
 */

import {
  AUTO_ROUTER_PROVIDER_TYPE,
  isConversationalProviderCandidate,
  type ProviderProfile,
  type SessionAgentAdapter,
} from '@spark/protocol'

import {
  isSameEngineKind,
  resolveCompatibleSessionAdapter,
  type AdapterCompatProviderInput,
} from './session-adapter-compat.js'

/** 重绑候选：启用中的非 router 对话渠道（默认位优先）。 */
export function pickRebindFallbackProvider(
  providers: readonly ProviderProfile[],
): ProviderProfile | null {
  const candidates = providers.filter(
    (item) =>
      item.enabled &&
      item.providerType !== AUTO_ROUTER_PROVIDER_TYPE &&
      isConversationalProviderCandidate(item),
  )
  return candidates.find((item) => item.isDefault) ?? candidates[0] ?? null
}

/** 单个会话的重绑落点：模型能沿用就沿用（同名模型跨渠道常见），否则落渠道默认。 */
export function resolveRebindModel(
  currentModelId: string | null,
  fallback: ProviderProfile,
): string {
  if (currentModelId != null && currentModelId.length > 0) {
    if (fallback.modelIds.includes(currentModelId)) return currentModelId
  }
  return fallback.defaultModel
}

function toCompatInput(profile: ProviderProfile): AdapterCompatProviderInput {
  return {
    id: profile.id,
    providerType: profile.providerType ?? profile.provider,
    ...(profile.codexApiKind != null ? { codexApiKind: profile.codexApiKind } : {}),
    ...(profile.autoRouterConfig?.adapter != null
      ? { autoRouterAdapter: profile.autoRouterConfig.adapter }
      : {}),
  }
}

/**
 * 引擎校准：会话当前引擎不能执行重绑渠道时改落可用引擎；兼容时返回 null
 * （不动会话的引擎与权限，claude/claude-sdk 归一化差异也不算切换）。
 */
export function resolveRebindAdapter(
  currentAdapter: string,
  fallback: ProviderProfile,
): SessionAgentAdapter | null {
  const normalized: SessionAgentAdapter =
    currentAdapter === 'claude' ||
    currentAdapter === 'claude-sdk' ||
    currentAdapter === 'codex' ||
    currentAdapter === 'spark'
      ? currentAdapter
      : 'claude-sdk'
  const calibrated = resolveCompatibleSessionAdapter(toCompatInput(fallback), normalized)
  return isSameEngineKind(calibrated, normalized) ? null : calibrated
}

export interface ProviderRebindPlan {
  fallback: ProviderProfile | null
  rebinds: Array<{
    sessionId: string
    providerProfileId: string
    modelId: string | null
    /** 仅在引擎与新渠道协议不匹配时给出（调用方连同权限模式一起回落）。 */
    agentAdapter?: SessionAgentAdapter
  }>
}

/**
 * 纯函数：给定被删渠道名下的会话与当前可用渠道，产出重绑计划。
 * 无可用对话渠道时 fallback 为 null、rebinds 为空（调用方保持原状并记日志）。
 */
export function resolveProviderRebindPlan(args: {
  sessions: ReadonlyArray<{ id: string; modelId: string | null; agentAdapter: string }>
  providers: readonly ProviderProfile[]
}): ProviderRebindPlan {
  const fallback = pickRebindFallbackProvider(args.providers)
  if (fallback == null || args.sessions.length === 0) {
    return { fallback, rebinds: [] }
  }
  return {
    fallback,
    rebinds: args.sessions.map((session) => {
      const adapter = resolveRebindAdapter(session.agentAdapter, fallback)
      return {
        sessionId: session.id,
        providerProfileId: fallback.id,
        modelId: resolveRebindModel(session.modelId, fallback),
        ...(adapter != null ? { agentAdapter: adapter } : {}),
      }
    }),
  }
}
