import type { TeamModeConfig } from '@spark/protocol'
import type { AgentRepository, TeamDefinitionRepository } from '@spark/storage'

export function resolveScheduledTaskTeam(
  teamId: string | null | undefined,
  teams: Pick<TeamDefinitionRepository, 'get'>,
  agents: Pick<AgentRepository, 'get'>,
): TeamModeConfig | undefined {
  if (teamId == null) return undefined
  const team = teams.get(teamId)
  if (!team?.enabled) throw new Error(`Scheduled task team is unavailable: ${teamId}`)
  if (!agents.get(team.hostAgentId)?.enabled) {
    throw new Error(`Scheduled task team host is unavailable: ${team.hostAgentId}`)
  }
  return {
    enabled: true,
    teamId: team.id,
    hostAgentId: team.hostAgentId,
    memberAgentIds: team.memberAgentIds.filter(
      (id) => id !== team.hostAgentId && agents.get(id)?.enabled,
    ),
    maxDepth: team.maxDepth,
    allowNesting: team.allowNesting,
    maxDiscussionRounds: team.maxDiscussionRounds ?? 6,
    enablePeerMessaging: team.enablePeerMessaging === true,
  }
}
