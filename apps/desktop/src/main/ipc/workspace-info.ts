import path from 'node:path'
import type { CanvasProjectRow, WorkspaceRow } from '@spark/storage'
import type { WorkspaceInfo } from '@spark/protocol'

type WorkspaceInfoRow = Pick<
  WorkspaceRow,
  | 'id'
  | 'name'
  | 'root_path'
  | 'created_at'
  | 'updated_at'
  | 'pinned_at'
  | 'archived_at'
  | 'worktree_meta_json'
>

/**
 * 为 workspace 响应附加画布来源标记。
 *
 * canvas_projects.root_path 是画布项目与普通 workspace 的权威关联；这里统一规范化路径，
 * 避免 UI 依赖 `canvas_project_` 名称后缀或默认 canvas-projects 目录。
 */
export function createWorkspaceInfoMapper(
  canvasProjects: ReadonlyArray<Pick<CanvasProjectRow, 'id' | 'root_path'>>,
): (workspace: WorkspaceInfoRow) => WorkspaceInfo {
  const canvasProjectIdByRootPath = new Map<string, string>()
  for (const project of canvasProjects) {
    if (project.root_path == null || project.root_path.trim().length === 0) continue
    canvasProjectIdByRootPath.set(path.resolve(project.root_path), project.id)
  }

  return (workspace) => ({
    id: workspace.id,
    name: workspace.name,
    rootPath: workspace.root_path,
    canvasProjectId: canvasProjectIdByRootPath.get(path.resolve(workspace.root_path)) ?? null,
    pinnedAt: workspace.pinned_at,
    archivedAt: workspace.archived_at,
    createdAt: workspace.created_at,
    updatedAt: workspace.updated_at,
    worktreeMeta: (() => {
      if (workspace.worktree_meta_json == null) return null
      try {
        return JSON.parse(workspace.worktree_meta_json) as {
          baseRepoRoot: string
          branch: string
          baseBranch: string
          baseWorkspaceId?: string
        }
      } catch {
        return null
      }
    })(),
  })
}
