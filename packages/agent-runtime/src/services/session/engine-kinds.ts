import type { SessionAgentAdapter, SessionPermissionMode } from '@spark/protocol'
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

/** spark 侧权限模式字面量（对齐 spark-engine 的 default/acceptEdits/plan/bypass 四模式）。 */
const SPARK_PERMISSION_MODES: readonly SessionPermissionMode[] = [
  'spark-default',
  'spark-accept-edits',
  'spark-plan',
  'spark-bypass',
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
