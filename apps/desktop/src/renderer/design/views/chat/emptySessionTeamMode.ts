import type { ManagedTeam, TeamModeConfig } from '@spark/protocol'

export async function persistThenSyncTeamSelection(
  persist: () => Promise<void>,
  syncRuntime: () => Promise<void>,
): Promise<void> {
  await persist()
  await syncRuntime()
}

export function preserveExplicitEmptySessionTeamConfig(
  current: TeamModeConfig,
  fallback: TeamModeConfig,
): TeamModeConfig {
  return current.enabled ? current : fallback
}

export function selectInitialTeam(
  teams: ManagedTeam[],
  preferredTeamId: string | undefined,
  validAgentIds: ReadonlySet<string>,
): ManagedTeam | null {
  const usable = teams.filter(
    (team) => team.enabled !== false && validAgentIds.has(team.hostAgentId),
  )
  return usable.find((team) => team.id === preferredTeamId) ?? usable[0] ?? null
}
