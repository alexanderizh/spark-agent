import { describe, expect, it } from 'vitest'
import {
  resolveSidebarActiveWorkspaceId,
  resolveSpecialSidebarGroupWorkspaceId,
} from './sidebar-session-routing'

describe('sidebar session routing', () => {
  it('maps worktree sessions back to their base workspace', () => {
    expect(
      resolveSidebarActiveWorkspaceId({ workspaceIds: ['worktree-1'] }, [
        {
          id: 'worktree-1',
          name: 'feature branch',
          rootPath: '/tmp/feature',
          pinnedAt: null,
          archivedAt: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
          worktreeMeta: {
            baseRepoRoot: '/repo',
            branch: 'codex/feature',
            baseBranch: 'main',
            baseWorkspaceId: 'base-1',
          },
        },
      ]),
    ).toBe('base-1')
  })

  it('keeps regular sessions on their own workspace', () => {
    expect(
      resolveSidebarActiveWorkspaceId({ workspaceIds: ['workspace-1'] }, [
        {
          id: 'workspace-1',
          name: 'Spark-Agent',
          rootPath: '/repo',
          pinnedAt: null,
          archivedAt: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
          worktreeMeta: null,
        },
      ]),
    ).toBe('workspace-1')
  })

  it('handles sessions without any workspace binding', () => {
    expect(resolveSidebarActiveWorkspaceId({ workspaceIds: [] }, [])).toBeNull()
  })

  it('resolves special flat groups', () => {
    expect(resolveSpecialSidebarGroupWorkspaceId('project:no-project', 'temp-1')).toBe('temp-1')
    expect(resolveSpecialSidebarGroupWorkspaceId('project:ungrouped', 'temp-1')).toBeNull()
    expect(resolveSpecialSidebarGroupWorkspaceId('date:today', 'temp-1')).toBeUndefined()
  })
})
