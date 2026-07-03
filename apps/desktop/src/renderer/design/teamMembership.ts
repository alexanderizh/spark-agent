/**
 * 团队成员归属工具。
 *
 * team.memberAgentIds 可能残留已删 agent 的「幽灵 id」（后端清理不彻底或历史脏数据）。
 * UI 展示数量前必须按当前真实 agents 过滤，否则 .length 会多算。
 *
 * 注意：host 不在 memberAgentIds 里（设计如此），这里只过滤 memberAgentIds 本身，
 * 不额外剔除 host。
 */

export function filterExistingMembers(
  memberAgentIds: string[],
  agents: Array<{ id: string }>,
): string[] {
  const existing = new Set(agents.map((a) => a.id))
  return memberAgentIds.filter((id) => existing.has(id))
}

export function countExistingMembers(
  memberAgentIds: string[],
  agents: Array<{ id: string }>,
): number {
  return filterExistingMembers(memberAgentIds, agents).length
}

/**
 * 团队总人数：含主持人在内的现存成员总数。
 *
 * host 通常不在 memberAgentIds 里（设计如此），但为防御脏数据双算，
 * 过滤 members 时显式排除 hostAgentId。已删 agent 的幽灵 id（无论在
 * host 还是 members 里）一律按 0 计。
 */
export function countTeamRoster(
  memberAgentIds: string[],
  hostAgentId: string | undefined | null,
  agents: Array<{ id: string }>,
): number {
  const existing = new Set(agents.map((a) => a.id))
  const hostCount = hostAgentId && existing.has(hostAgentId) ? 1 : 0
  const memberCount = memberAgentIds.filter(
    (id) => existing.has(id) && id !== hostAgentId,
  ).length
  return hostCount + memberCount
}
