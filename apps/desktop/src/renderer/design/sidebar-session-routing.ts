import type { WorkspaceInfo } from '@spark/protocol'

type SessionWorkspaceRef = {
  workspaceIds: string[]
}

export function resolveSidebarActiveWorkspaceId(
  session: SessionWorkspaceRef,
  workspaces: WorkspaceInfo[],
): string | null {
  const firstWorkspaceId = session.workspaceIds[0]
  if (firstWorkspaceId == null) return null
  const workspace = workspaces.find((item) => item.id === firstWorkspaceId)
  return workspace?.worktreeMeta?.baseWorkspaceId ?? firstWorkspaceId
}

export function resolveSpecialSidebarGroupWorkspaceId(
  groupId: string,
  noProjectWorkspaceId: string | null,
): string | null | undefined {
  if (groupId === 'project:no-project') return noProjectWorkspaceId
  if (groupId === 'project:ungrouped') return null
  return undefined
}
