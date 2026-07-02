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

export function resolveDisplayedGitBranch(options: {
  branchStateCurrentBranch: string | null
  statusCurrentBranch: string | null | undefined
}): string | null {
  return options.branchStateCurrentBranch ?? options.statusCurrentBranch ?? null
}

export function canShowComposerWorktreeToggle(options: {
  sessionId: string | null | undefined
  sessionMessageCount: number | null | undefined
  sessionStatus: string | null | undefined
  loadedMessageCount: number
}): boolean {
  if (options.sessionId == null) return true
  if (options.sessionStatus === 'running') return false
  if ((options.sessionMessageCount ?? 0) > 0) return false
  if (options.loadedMessageCount > 0) return false
  return true
}
