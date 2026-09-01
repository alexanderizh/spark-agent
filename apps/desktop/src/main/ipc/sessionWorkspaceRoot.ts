import { ensureSessionWorkspaceRootPath } from '@spark/agent-runtime'
import { SessionRepository, WorkspaceRepository } from '@spark/storage'

import { getDatabase } from '../db.js'

/**
 * Resolve a workspace-backed UI operation to the filesystem root owned by one
 * session. Project workspaces keep their existing root; the shared no-project
 * workspace resolves to no-project/<sessionId>.
 */
export async function resolveSessionScopedWorkspaceRoot(
  workspaceId: string,
  sessionId?: string,
): Promise<string> {
  const database = getDatabase()
  const workspace = new WorkspaceRepository(database).findByIdOrFail(workspaceId)
  if (sessionId == null) return workspace.root_path

  const workspaceIds = new SessionRepository(database).getWorkspaceIds(sessionId)
  if (!workspaceIds.includes(workspace.id)) {
    throw new Error('Session is not associated with the requested workspace')
  }
  return ensureSessionWorkspaceRootPath(workspace, sessionId)
}
