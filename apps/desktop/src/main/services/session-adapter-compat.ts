/**
 * session-adapter-compat — 会话引擎与渠道协议的兼容性归一（主进程侧纯函数）。
 *
 * 渲染端 Composer/渠道选择一直受 isProviderCompatibleWithAdapter 约束：
 * codex 引擎 ↔ OpenAI 系协议渠道；Claude 引擎 ↔ Anthropic 协议渠道；
 * spark 引擎按上游协议可映射性判定。但主进程的惰性建会话入口
 * （语音助手、远程连接）只分别解析「渠道」与「引擎」，不经过渲染端校验，
 * 可能组合出注定失败的会话——例如运行时默认引擎为 codex、默认渠道是
 * Anthropic 协议（火山方舟 Coding Plan）时，Codex 引擎把渠道端点当
 * OpenAI Responses 地址请求（<端点>/responses），得到 403
 * 「Unsupported zti authentication method」这类误导性报错。
 *
 * 这里把「按渠道协议校准引擎」收敛为主进程可复用的纯函数：
 * 引擎与渠道兼容时保留用户/Agent 偏好；不兼容时按渠道协议落到正确引擎。
 * 语义与渲染端 design/utils/provider-adapter.ts 保持一致，两处调整需同步。
 */

import {
  AUTO_ROUTER_PROVIDER_TYPE,
  isBuiltInLocalCliProvider,
  isLocalCodexCliProvider,
  type SessionAgentAdapter,
} from '@spark/protocol'

/** 兼容性判定所需的渠道最小信息（profile 与 provider 行都能低成本构造）。 */
export interface AdapterCompatProviderInput {
  /** 渠道行 id（本地 CLI 内置渠道靠 id 识别）。 */
  id: string
  /** provider_profiles.provider_type（anthropic / openai / auto-router / …）。 */
  providerType: string
  /** OpenAI 系渠道的接口风格（chat = Chat Completions；缺省按 responses 口径）。 */
  codexApiKind?: 'chat' | 'responses' | 'embedding' | undefined
  /** AutoRouter 行声明的引擎（config 解析失败时缺省，按 claude 处理）。 */
  autoRouterAdapter?: 'claude' | 'codex' | undefined
}

function isClaudeKind(adapter: SessionAgentAdapter): boolean {
  return adapter === 'claude' || adapter === 'claude-sdk'
}

/**
 * 引擎类别是否实质相同（claude/claude-sdk 同类；归一化差异不算引擎切换）。
 * 远程 use-channel/use-agent 与渠道删除级联重绑共用：只有类别真正变化才
 * 连带重置权限模式，避免兼容场景下误伤用户已选的权限。
 */
export function isSameEngineKind(a: SessionAgentAdapter, b: SessionAgentAdapter): boolean {
  const aSpark = a === 'spark'
  const bSpark = b === 'spark'
  return isClaudeKind(a) === isClaudeKind(b) && aSpark === bSpark
}

/**
 * 按渠道协议校准会话引擎：preferred 兼容则原样保留，不兼容时落到该渠道
 * 可用的引擎（anthropic → claude-sdk；openai 系 → codex；spark 按可映射性保留）。
 */
export function resolveCompatibleSessionAdapter(
  provider: AdapterCompatProviderInput,
  preferred: SessionAgentAdapter,
): SessionAgentAdapter {
  // 本地 CLI 内置渠道只有自家引擎一条执行链。
  if (isLocalCodexCliProvider(provider)) return 'codex'
  if (isBuiltInLocalCliProvider(provider)) return 'claude-sdk'
  // AutoRouter 行按其声明的引擎判定（spark 引擎不接管 AutoRouter）。
  if (provider.providerType === AUTO_ROUTER_PROVIDER_TYPE) {
    const routerAdapter = provider.autoRouterAdapter === 'codex' ? 'codex' : 'claude'
    if (preferred === 'spark') return routerAdapter === 'codex' ? 'codex' : 'claude-sdk'
    return isClaudeKind(preferred)
      ? routerAdapter === 'claude'
        ? 'claude-sdk'
        : 'codex'
      : routerAdapter === 'codex'
        ? 'codex'
        : 'claude-sdk'
  }
  if (provider.providerType === 'anthropic') {
    // Anthropic 协议只能由 Claude / Spark 引擎执行；Codex 引擎（OpenAI 系
    // wire 协议）无法承接。保留 spark 偏好，其余一律落 claude-sdk。
    return preferred === 'spark' ? 'spark' : 'claude-sdk'
  }
  // OpenAI 系协议：spark 偏好仅在 responses 口径可保留（chat-completions
  // 渠道 spark 引擎不支持，改落 codex）；claude 系引擎不能直连，落 codex。
  if (preferred === 'spark') {
    return provider.codexApiKind === 'chat' ? 'codex' : 'spark'
  }
  return 'codex'
}
