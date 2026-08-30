import { describe, expect, it } from 'vitest'
import { SidebarOrderController } from './registerSidebarOrderIpc.js'

function createHarness() {
  const values = new Map<string, unknown>()
  const workspaceMeta = new Map<
    string,
    { baseRepoRoot: string; branch: string; baseBranch: string; baseWorkspaceId?: string } | null
  >([
    ['project-a', null],
    ['project-b', null],
    ['temp-project', null],
    [
      'worktree-a',
      {
        baseRepoRoot: '/repo/a',
        branch: 'feature/a',
        baseBranch: 'main',
        baseWorkspaceId: 'project-a',
      },
    ],
  ])
  const sessionWorkspaceIds = new Map<string, string[]>([
    ['session-a', ['project-a']],
    ['session-a-worktree', ['worktree-a']],
    ['session-b', ['project-b']],
    ['session-temp', ['temp-project']],
  ])
  const controller = new SidebarOrderController({
    settings: {
      getByCategory: () => Object.fromEntries(values),
      set: (_category, key, value) => values.set(key, value),
    },
    workspaces: {
      get: (id) => (workspaceMeta.has(id) ? { id } : null),
      getWorktreeMeta: (id) => workspaceMeta.get(id) ?? null,
    },
    sessions: {
      get: (id) => (sessionWorkspaceIds.has(id) ? { id } : null),
      getWorkspaceIds: (id) => sessionWorkspaceIds.get(id) ?? [],
    },
  })
  return { controller }
}

describe('SidebarOrderController', () => {
  it('persists normal and temporary projects in one manual order', () => {
    const { controller } = createHarness()
    controller.update({
      scope: 'projects',
      itemIds: ['temp-project', 'project-b', 'project-a'],
    })
    expect(controller.list().projectIds).toEqual(['temp-project', 'project-b', 'project-a'])
  })

  it('accepts sessions bound through a worktree of the same base project', () => {
    const { controller } = createHarness()
    controller.update({
      scope: 'sessions',
      projectId: 'project-a',
      itemIds: ['session-a-worktree', 'session-a'],
    })
    expect(controller.list().sessionIdsByProject['project-a']).toEqual([
      'session-a-worktree',
      'session-a',
    ])
  })

  it('rejects moving a session into another project order', () => {
    const { controller } = createHarness()
    expect(() =>
      controller.update({
        scope: 'sessions',
        projectId: 'project-a',
        itemIds: ['session-b'],
      }),
    ).toThrow('会话只能在所属项目内部排序')
  })

  it('supports the temporary-session project as a session order parent', () => {
    const { controller } = createHarness()
    controller.update({
      scope: 'sessions',
      projectId: 'temp-project',
      itemIds: ['session-temp'],
    })
    expect(controller.list().sessionIdsByProject['temp-project']).toEqual(['session-temp'])
  })
})
