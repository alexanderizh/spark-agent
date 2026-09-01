import { mkdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { NO_PROJECT_WORKSPACE_NAME } from '@spark/protocol'

export { NO_PROJECT_WORKSPACE_NAME } from '@spark/protocol'

export interface SessionWorkspaceRootSource {
  name: string
  root_path: string
}

const SAFE_SESSION_DIRECTORY_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/

export function isNoProjectWorkspace(workspace: SessionWorkspaceRootSource): boolean {
  return workspace.name === NO_PROJECT_WORKSPACE_NAME
}

/**
 * Resolve the filesystem root visible to one session.
 *
 * Project sessions keep using the workspace root. Sessions grouped under the
 * shared no-project workspace receive a child directory named after sessionId,
 * preventing generated files and agent edits from leaking across sessions.
 */
export function resolveSessionWorkspaceRootPath(
  workspace: SessionWorkspaceRootSource,
  sessionId: string,
): string {
  const workspaceRoot = path.resolve(workspace.root_path)
  if (!isNoProjectWorkspace(workspace)) return workspaceRoot

  const directoryName = sessionId.trim()
  if (
    directoryName === '.' ||
    directoryName === '..' ||
    !SAFE_SESSION_DIRECTORY_NAME.test(directoryName)
  ) {
    throw new Error(`Invalid session id for workspace directory: ${sessionId}`)
  }
  return path.join(workspaceRoot, directoryName)
}

export async function ensureSessionWorkspaceRootPath(
  workspace: SessionWorkspaceRootSource,
  sessionId: string,
): Promise<string> {
  const rootPath = resolveSessionWorkspaceRootPath(workspace, sessionId)
  if (isNoProjectWorkspace(workspace)) {
    await mkdir(rootPath, { recursive: true })
  }
  return rootPath
}

export function ensureSessionWorkspaceRootPathSync(
  workspace: SessionWorkspaceRootSource,
  sessionId: string,
): string {
  const rootPath = resolveSessionWorkspaceRootPath(workspace, sessionId)
  if (isNoProjectWorkspace(workspace)) mkdirSync(rootPath, { recursive: true })
  return rootPath
}
