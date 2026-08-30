import type { WorkspaceInfo } from '@spark/protocol'
import type { SessionSummary } from './SessionSidebarContext'

const LEGACY_CANVAS_WORKSPACE_BASENAME = /-canvas_project_[a-z0-9]+_[a-z0-9]+$/i

/**
 * 主进程已通过 canvas_projects.root_path 做过权威关联。
 *
 * 仅当字段完全缺省（旧主进程尚未重启或旧版本响应）时，兼容识别画布自动生成的严格目录
 * 后缀；新主进程明确返回 null 时不做名称猜测。
 */
export function isCanvasWorkspace(workspace: WorkspaceInfo): boolean {
  if (workspace.canvasProjectId !== undefined) return workspace.canvasProjectId != null
  const basename = workspace.rootPath.split(/[/\\]/).filter(Boolean).at(-1) ?? ''
  return LEGACY_CANVAS_WORKSPACE_BASENAME.test(basename)
}

export function getCanvasWorkspaceIds(workspaces: WorkspaceInfo[]): Set<string> {
  const canvasWorkspaceIds = new Set(
    workspaces.filter(isCanvasWorkspace).map((workspace) => workspace.id),
  )
  // Worktree 路径通常位于画布项目目录之外，需从其 base workspace 继承画布归属。
  for (const workspace of workspaces) {
    const baseWorkspaceId = workspace.worktreeMeta?.baseWorkspaceId
    if (baseWorkspaceId != null && canvasWorkspaceIds.has(baseWorkspaceId)) {
      canvasWorkspaceIds.add(workspace.id)
    }
  }
  return canvasWorkspaceIds
}

export function filterCanvasWorkspaces(
  workspaces: WorkspaceInfo[],
  includeCanvasProjects: boolean,
): WorkspaceInfo[] {
  if (includeCanvasProjects) return workspaces
  const canvasWorkspaceIds = getCanvasWorkspaceIds(workspaces)
  return workspaces.filter((workspace) => !canvasWorkspaceIds.has(workspace.id))
}

export function isCanvasSession(
  session: Pick<SessionSummary, 'workspaceIds'>,
  canvasWorkspaceIds: ReadonlySet<string>,
): boolean {
  return session.workspaceIds.some((workspaceId) => canvasWorkspaceIds.has(workspaceId))
}

export function filterCanvasSessions(
  sessions: SessionSummary[],
  workspaces: WorkspaceInfo[],
): SessionSummary[] {
  const canvasWorkspaceIds = getCanvasWorkspaceIds(workspaces)
  if (canvasWorkspaceIds.size === 0) return sessions
  return sessions.filter((session) => !isCanvasSession(session, canvasWorkspaceIds))
}

/** 输入器使用的全部普通项目；仅排序，不截断数量。 */
export function listSelectableWorkspaces(
  workspaces: WorkspaceInfo[],
  noProjectWorkspaceName: string,
): WorkspaceInfo[] {
  return workspaces
    .filter(
      (workspace) =>
        workspace.name !== noProjectWorkspaceName &&
        workspace.worktreeMeta == null &&
        !workspace.archivedAt &&
        !isCanvasWorkspace(workspace),
    )
    .sort((a, b) => {
      const aTime = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime()
      const bTime = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime()
      return bTime - aTime
    })
}
