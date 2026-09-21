import type { RouterAdapter, SessionAgentAdapter, SessionPermissionMode } from '@spark/protocol'
import type { EngineKind } from '../../sdk/engine-executor.js'

/**
 * 引擎归一化模块（P1-W1-D4）。
 *
 * 职责：把「adapter 口径 → 引擎口径」的归一收敛到单一穷尽 switch，
 * 并收编 session.service 原散落的四个归一化纯函数（:10453-10500 迁入）。
 * 新增 SessionAgentAdapter 值而未在此登记时，resolveEngineKind 的穷尽
 * switch 会直接编译失败——替代此前 11 处手写 `'claude-sdk' || 'claude'`
 * 归并对新值的静默吞并。
 */

/** 与 protocol 的 SessionAgentAdapter 同一类型（原 session-resume-gate 的逐字复制版收敛为别名）。 */
export type AgentAdapterKind = SessionAgentAdapter

/**
 * adapter 口径（4 值，含历史值 'claude'）→ 引擎口径（3 值）。
 * 穷尽 switch：新增 adapter 值漏配即编译错。
 */
export function resolveEngineKind(adapter: AgentAdapterKind): EngineKind {
  switch (adapter) {
    case 'claude':
    case 'claude-sdk':
      return 'claude-sdk'
    case 'codex':
      return 'codex'
    case 'spark':
      return 'spark'
  }
}

/** codex 侧权限模式字面量（查表替代 `startsWith('codex-')` 前缀嗅探）。 */
const CODEX_PERMISSION_MODES: readonly SessionPermissionMode[] = [
  'codex-default',
  'codex-auto-review',
  'codex-full-access',
]

/** spark 侧权限模式字面量（三档：手动审批/自动审批/完全访问；旧两值为存量会话保留）。 */
const SPARK_PERMISSION_MODES: readonly SessionPermissionMode[] = [
  'spark-default',
  'spark-auto',
  'spark-bypass',
  // 旧版四档残留（spark-accept-edits / spark-plan）：不再出现在 UI，
  // 但已存储会话仍带这些值，识别后由 toSparkEnginePermissionMode 回落 manual。
  'spark-accept-edits',
  'spark-plan',
]

export function isSparkPermissionMode(value: string | null | undefined): boolean {
  return SPARK_PERMISSION_MODES.includes(value as SessionPermissionMode)
}

/**
 * 判断权限模式值是否属于 codex 侧。
 * 与旧 `startsWith('codex-')` 对全部合法值与 claude 侧任意值行为一致；
 * 差异仅在非法 'codex-*' 脏字符串（当前无写入方）：旧实现归为 codex，
 * 查表后归为 claude（系统默认侧，更保守）。
 */
export function isCodexPermissionMode(value: string | null | undefined): boolean {
  return CODEX_PERMISSION_MODES.includes(value as SessionPermissionMode)
}

export function getAgentAdapterFromSession(
  value: string | null | undefined,
  legacyChatMode: string | null | undefined,
  providerType: string | null,
  useSparkExecutor?: boolean | null,
): AgentAdapterKind {
  if (value === 'claude-sdk' || value === 'codex' || value === 'spark') return value
  if (value === 'claude') return 'claude-sdk'
  if (legacyChatMode === 'claude-sdk' || legacyChatMode === 'codex' || legacyChatMode === 'spark') {
    return legacyChatMode
  }
  if (legacyChatMode === 'claude') return 'claude-sdk'
  // 渠道级开关：开启 Spark 执行器的渠道，会话默认走 spark 引擎（用户仍可显式切换）。
  if (useSparkExecutor === true) return 'spark'
  // Default: Anthropic providers use claude-sdk. Direct Anthropic API is not a
  // supported execution path for the core code agent.
  return providerType === 'anthropic' ? 'claude-sdk' : 'codex'
}

/**
 * 取会话显式声明的引擎（无显式值时返回 null，不做兜底）。
 *
 * 与 getAgentAdapterFromSession 的区别：后者在会话没写 adapter/chat_mode 时会按
 * 渠道 protocol 兜底（providerType=null 一律判 codex），无法区分"用户显式选了
 * codex"与"会话里压根没写"。router 分支需要在缺省时改按 router 声明引擎假定，
 * 因此需要这个不做兜底的版本。
 */
function readExplicitEngineKind(
  value: string | null | undefined,
): 'claude-sdk' | 'codex' | 'spark' | null {
  if (value === 'claude-sdk' || value === 'claude') return 'claude-sdk'
  if (value === 'codex') return 'codex'
  if (value === 'spark') return 'spark'
  return null
}

/**
 * AutoRouter 会话引擎推导（router 行专用）。
 *
 * 为什么不能直接套 getAgentAdapterFromSession(..., providerType=null)：router 行
 * 自身没有渠道 protocol 可供兜底，缺省时该函数一律判 codex；而 startTurnExecution
 * 主线在替换成执行器渠道后会用执行器的 provider_type 复算引擎（anthropic →
 * claude-sdk，其余 → codex）。于是在"会话无显式 adapter/chat_mode"时，claude
 * router 会被判成 adapterMismatch（回退码系执行器，或干脆报没有可用执行模型）。
 * 这里显式缺省时改用 router 声明的 adapter 假定会话引擎：替换后主线拿到 anthropic
 * 系执行器恰好复算出 claude-sdk，两侧判定自洽。
 *
 * spark 引擎与 claude 同侧（router 只声明 claude / codex 两档，保持既有映射）。
 */
export function resolveRouterSessionAdapter(params: {
  /** 会话显式 adapter（agent_adapter / 成员 agentAdapter 回落快照）。 */
  sessionAdapter: string | null | undefined
  /** 会话 chat_mode（历史 adapter 落点）。 */
  chatMode: string | null | undefined
  /** router 行声明的引擎；router 配置无效时为 null。 */
  routerAdapter: RouterAdapter | null
}): RouterAdapter {
  const explicit = readExplicitEngineKind(params.sessionAdapter)
  if (explicit != null) return explicit === 'codex' ? 'codex' : 'claude'
  const legacy = readExplicitEngineKind(params.chatMode)
  if (legacy != null) return legacy === 'codex' ? 'codex' : 'claude'
  return params.routerAdapter ?? 'codex'
}

export function getPermissionModeFromSession(
  value: string | null | undefined,
  adapter: AgentAdapterKind,
): SessionPermissionMode {
  if (
    value === 'claude-ask' ||
    value === 'claude-auto-edits' ||
    value === 'claude-plan' ||
    value === 'claude-auto' ||
    value === 'claude-bypass' ||
    value === 'codex-default' ||
    value === 'codex-auto-review' ||
    value === 'codex-full-access' ||
    value === 'spark-default' ||
    value === 'spark-auto' ||
    value === 'spark-accept-edits' ||
    value === 'spark-plan' ||
    value === 'spark-bypass'
  ) {
    return value
  }
  if (adapter === 'codex') return 'codex-default'
  if (adapter === 'spark') return 'spark-default'
  return 'claude-ask'
}

function normalizeAgentAdapter(value: string | null | undefined): AgentAdapterKind {
  if (value === 'claude' || value === 'claude-sdk') return 'claude-sdk'
  if (value === 'codex') return 'codex'
  if (value === 'spark') return 'spark'
  return 'claude-sdk'
}

function normalizePermissionMode(value: string | null | undefined): SessionPermissionMode {
  const adapter: AgentAdapterKind = isCodexPermissionMode(value)
    ? 'codex'
    : isSparkPermissionMode(value)
      ? 'spark'
      : 'claude-sdk'
  return getPermissionModeFromSession(value, adapter)
}

// 供 session.service 内部使用（原模块私有函数迁出后的导出面）。
export { normalizeAgentAdapter, normalizePermissionMode }
