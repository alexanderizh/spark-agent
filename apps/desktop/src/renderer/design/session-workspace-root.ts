import { NO_PROJECT_WORKSPACE_NAME, type WorkspaceInfo } from '@spark/protocol'

export { NO_PROJECT_WORKSPACE_NAME } from '@spark/protocol'

export function resolveSessionWorkspaceRootPathForDisplay(
  workspace: Pick<WorkspaceInfo, 'name' | 'rootPath'> | null | undefined,
  sessionId: string | null | undefined,
): string | null {
  if (workspace == null) return null
  if (workspace.name !== NO_PROJECT_WORKSPACE_NAME || sessionId == null) {
    return workspace.rootPath
  }
  const separator =
    workspace.rootPath.includes('\\') && !workspace.rootPath.includes('/') ? '\\' : '/'
  const rootPath = workspace.rootPath.replace(/[\\/]+$/, '')
  return rootPath === '' ? `${separator}${sessionId}` : `${rootPath}${separator}${sessionId}`
}

export function resolveSessionWorkspaceForDisplay(
  workspace: WorkspaceInfo | null | undefined,
  sessionId: string | null | undefined,
): WorkspaceInfo | null {
  if (workspace == null) return null
  const rootPath = resolveSessionWorkspaceRootPathForDisplay(workspace, sessionId)
  return rootPath == null || rootPath === workspace.rootPath
    ? workspace
    : { ...workspace, rootPath }
}

export function resolvePathAgainstWorkspaceRoot(
  filePath: string,
  workspaceRootPath: string | null | undefined,
): string {
  if (
    workspaceRootPath == null ||
    /^https?:\/\//i.test(filePath) ||
    filePath.startsWith('safe-file://') ||
    filePath.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(filePath)
  ) {
    return filePath
  }
  const separator = workspaceRootPath.includes('\\') ? '\\' : '/'
  const relativePath = filePath.replace(/^\.\//, '').replace(/^[\\/]+/, '')
  return `${workspaceRootPath.replace(/[\\/]+$/, '')}${separator}${relativePath}`
}
