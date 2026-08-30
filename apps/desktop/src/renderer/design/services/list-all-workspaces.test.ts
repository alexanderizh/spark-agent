import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceInfo } from '@spark/protocol'
import { listAllWorkspaces } from './list-all-workspaces'

function workspace(id: string): WorkspaceInfo {
  return {
    id,
    name: id,
    rootPath: `/tmp/${id}`,
    pinnedAt: null,
    archivedAt: null,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    worktreeMeta: null,
  }
}

describe('listAllWorkspaces', () => {
  it('continues paging until every workspace is loaded', async () => {
    const all = Array.from({ length: 205 }, (_, index) => workspace(`workspace-${index}`))
    const listPage = vi.fn(async ({ limit = 50, offset = 0 }) => ({
      workspaces: all.slice(offset, offset + limit),
      total: all.length,
    }))

    const result = await listAllWorkspaces(listPage)

    expect(result.workspaces).toHaveLength(205)
    expect(listPage).toHaveBeenCalledTimes(3)
    expect(listPage).toHaveBeenNthCalledWith(3, { limit: 100, offset: 200 })
  })
})
