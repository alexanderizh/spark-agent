import { describe, expect, it } from 'vitest'
import type { WorkspaceInfo } from '@spark/protocol'
import {
  filterCanvasSessions,
  isCanvasWorkspace,
  listSelectableWorkspaces,
} from './workspace-visibility'

function workspace(id: string, overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    id,
    name: id,
    rootPath: `/tmp/${id}`,
    pinnedAt: null,
    archivedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    worktreeMeta: null,
    ...overrides,
  }
}

describe('workspace visibility', () => {
  it('uses the explicit canvas marker instead of a naming convention', () => {
    expect(
      isCanvasWorkspace(workspace('ordinary-canvas_project_name', { canvasProjectId: null })),
    ).toBe(false)
    expect(isCanvasWorkspace(workspace('canvas', { canvasProjectId: 'canvas-1' }))).toBe(true)
  })

  it('recognizes generated canvas directories only when an old response omits the marker', () => {
    expect(
      isCanvasWorkspace(
        workspace('legacy', {
          rootPath: '/tmp/剑来（导入）-canvas_project_mqf3si1y_rfck06',
        }),
      ),
    ).toBe(true)
    expect(
      isCanvasWorkspace(
        workspace('explicitly-ordinary', {
          rootPath: '/tmp/demo-canvas_project_mqf3si1y_rfck06',
          canvasProjectId: null,
        }),
      ),
    ).toBe(false)
    expect(isCanvasWorkspace(workspace('Spark-Canvas'))).toBe(false)
  })

  it('filters canvas sessions from ordinary conversation surfaces', () => {
    const workspaces = [workspace('code'), workspace('canvas', { canvasProjectId: 'canvas-1' })]
    const sessions = [
      { id: 'code-session', workspaceIds: ['code'] },
      { id: 'canvas-session', workspaceIds: ['canvas'] },
    ] as Parameters<typeof filterCanvasSessions>[0]

    expect(filterCanvasSessions(sessions, workspaces).map((session) => session.id)).toEqual([
      'code-session',
    ])
  })

  it('returns every ordinary selectable project without a five-item limit', () => {
    const workspaces = Array.from({ length: 8 }, (_, index) =>
      workspace(`project-${index}`, {
        updatedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    )
    workspaces.push(
      workspace('canvas', { canvasProjectId: 'canvas-1' }),
      workspace('temporary', { name: '不使用项目' }),
      workspace('archived', { archivedAt: '2026-07-30T00:00:00.000Z' }),
    )

    const selectable = listSelectableWorkspaces(workspaces, '不使用项目')

    expect(selectable).toHaveLength(8)
    expect(selectable[0]?.id).toBe('project-7')
    expect(selectable.at(-1)?.id).toBe('project-0')
  })
})
