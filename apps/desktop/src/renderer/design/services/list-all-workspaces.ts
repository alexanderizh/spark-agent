import type { WorkspaceListRequest, WorkspaceListResponse } from '@spark/protocol'

const WORKSPACE_PAGE_SIZE = 100

/**
 * 读取全部 workspace。不能依赖单次较大的固定 limit，否则项目选择器仍会在该数字处截断。
 */
export async function listAllWorkspaces(
  listPage: (request: WorkspaceListRequest) => Promise<WorkspaceListResponse>,
): Promise<WorkspaceListResponse> {
  const byId = new Map<string, WorkspaceListResponse['workspaces'][number]>()
  let offset = 0
  let total = Number.POSITIVE_INFINITY

  while (offset < total) {
    const page = await listPage({ limit: WORKSPACE_PAGE_SIZE, offset })
    total = page.total
    for (const workspace of page.workspaces) byId.set(workspace.id, workspace)
    if (page.workspaces.length === 0) break
    offset += page.workspaces.length
  }

  return { workspaces: [...byId.values()], total: Number.isFinite(total) ? total : byId.size }
}
