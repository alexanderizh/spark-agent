/**
 * @module project-agent-scope
 *
 * 项目级 Agent 作用域。
 *
 * 项目（workspace）可通过 workspace:update 绑定：
 *   - defaultAgentId：项目默认 Agent，项目内新建会话时优先于全局「上次使用」；
 *   - allowedAgentIds：项目可用 Agent 白名单，聊天/画布选择器只显示白名单内 Agent。
 *
 * 兼容规则（与迁移 111/112 注释、主进程校验一致）：
 *   - 白名单为 null / 空数组 / 过滤后为空（全部悬空）时视为未绑定，显示全部启用 Agent；
 *   - 平台默认助手（platform-manager-agent）始终保留在可选列表中；
 *   - defaultAgentId 悬空（Agent 已删除/禁用）时视为未设置。
 */

import type { ManagedAgent, WorkspaceInfo } from '@spark/protocol'

/** 平台默认助手的稳定 ID（内置 Agent，非 UUID），始终保留在项目可选列表中 */
export const PLATFORM_DEFAULT_AGENT_ID = 'platform-manager-agent'

type ProjectAgentScopeSource = Pick<WorkspaceInfo, 'allowedAgentIds'> | null | undefined
type ProjectDefaultSource = Pick<WorkspaceInfo, 'defaultAgentId'> | null | undefined

/**
 * 项目绑定了 Agent 白名单时，过滤出白名单内的启用 Agent（平台默认助手始终保留）。
 * 未绑定或白名单全部悬空时返回原列表，避免把用户锁死在空选择器里。
 */
export function filterAgentsByProjectScope(
  agents: ManagedAgent[],
  workspace: ProjectAgentScopeSource,
): ManagedAgent[] {
  const allowed = workspace?.allowedAgentIds
  if (allowed == null || allowed.length === 0 || agents.length === 0) {
    return agents
  }
  const allowedSet = new Set(allowed)
  const filtered = agents.filter((agent) => allowedSet.has(agent.id))
  if (filtered.length === 0) {
    return agents
  }
  if (filtered.some((agent) => agent.id === PLATFORM_DEFAULT_AGENT_ID)) {
    return filtered
  }
  const fallback = agents.find((agent) => agent.id === PLATFORM_DEFAULT_AGENT_ID)
  return fallback != null ? [...filtered, fallback] : filtered
}

/**
 * 解析项目默认 Agent ID：未设置或悬空（不在当前启用列表中）返回 null。
 */
export function resolveProjectDefaultAgentId(
  agents: ManagedAgent[],
  workspace: ProjectDefaultSource,
): string | null {
  const id = workspace?.defaultAgentId
  if (id == null || id === '') {
    return null
  }
  return agents.some((agent) => agent.id === id) ? id : null
}
