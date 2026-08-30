import type { SessionPermissionMode, SessionReasoningEffort } from '@spark/protocol'

/**
 * 按 agentId 缓存用户上次在输入栏选择的 permissionMode / reasoningEffort。
 *
 * 用途：仅「新会话创建」时回填默认值（SessionSidebarContext.handleNewSession），
 * 实现「用同一个 agent 新建会话 → 自动沿用上次的参数选择」。
 *
 * 注意：这是渲染端 UX 缓存，独立于全局 composer-prefs（后者是跨 agent 的单值）。
 * 不同步到主进程 settings。adapter 兼容性校验留给使用点的 getValidPermissionMode。
 */
const AGENT_RUNTIME_PREFS_KEY = 'spark-agent:composer-agent-runtime-prefs'

export type AgentRuntimePrefs = {
  permissionMode?: SessionPermissionMode
  reasoningEffort?: SessionReasoningEffort
}

type AgentRuntimePrefsMap = Record<string, AgentRuntimePrefs>

const REASONING_EFFORTS: readonly SessionReasoningEffort[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

function normalizeReasoning(value: unknown): SessionReasoningEffort | undefined {
  return typeof value === 'string' &&
    (REASONING_EFFORTS as readonly string[]).includes(value)
    ? (value as SessionReasoningEffort)
    : undefined
}

function readMap(): AgentRuntimePrefsMap {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(AGENT_RUNTIME_PREFS_KEY)
    if (raw == null) return {}
    const parsed = JSON.parse(raw)
    return parsed != null && typeof parsed === 'object'
      ? (parsed as AgentRuntimePrefsMap)
      : {}
  } catch {
    return {}
  }
}

/** 读取单个 agent 上次缓存的运行时偏好；无缓存或解析失败返回 {}。 */
export function readAgentRuntimePrefs(agentId: string): AgentRuntimePrefs {
  if (!agentId) return {}
  const entry = readMap()[agentId]
  if (entry == null || typeof entry !== 'object') return {}
  const result: AgentRuntimePrefs = {}
  // permissionMode 只做基础类型校验；adapter 兼容性由使用点 getValidPermissionMode 收敛
  if (typeof entry.permissionMode === 'string') {
    result.permissionMode = entry.permissionMode as SessionPermissionMode
  }
  const reasoningEffort = normalizeReasoning(entry.reasoningEffort)
  if (reasoningEffort != null) result.reasoningEffort = reasoningEffort
  return result
}

/** 局部更新某个 agent 的缓存条目（仅 patch 提供的字段，其余保留）。 */
export function writeAgentRuntimePrefs(agentId: string, patch: AgentRuntimePrefs): void {
  if (typeof window === 'undefined' || !agentId) return
  try {
    const map = readMap()
    const prev: AgentRuntimePrefs = map[agentId] ?? {}
    const next: AgentRuntimePrefs = { ...prev }
    if (patch.permissionMode !== undefined && typeof patch.permissionMode === 'string') {
      next.permissionMode = patch.permissionMode
    }
    if (patch.reasoningEffort !== undefined) {
      const reasoningEffort = normalizeReasoning(patch.reasoningEffort)
      if (reasoningEffort != null) next.reasoningEffort = reasoningEffort
    }
    map[agentId] = next
    window.localStorage.setItem(AGENT_RUNTIME_PREFS_KEY, JSON.stringify(map))
  } catch {
    // localStorage 不可用或配额耗尽时静默忽略，不影响主流程
  }
}
