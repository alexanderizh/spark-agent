import type { WorkspaceInfo } from '@spark/protocol'

export function resolveComposerGitWorkspace(options: {
  showEmptyHero: boolean
  activeWorkspace: WorkspaceInfo | null
  activeSessionWorkspace: WorkspaceInfo | null
}): WorkspaceInfo | null {
  if (options.showEmptyHero) {
    return options.activeWorkspace ?? options.activeSessionWorkspace
  }
  return options.activeSessionWorkspace
}

export function canReuseComposerSession(options: {
  sessionId: string | null | undefined
  sessionWorkspaceId: string | null | undefined
  activeWorkspaceId: string | null
  preferSelectedWorkspace: boolean | undefined
}): boolean {
  if (options.sessionId == null) return false
  if (!options.preferSelectedWorkspace || options.activeWorkspaceId == null) return true
  return options.sessionWorkspaceId === options.activeWorkspaceId
}
