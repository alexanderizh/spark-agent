import { describe, expect, it } from 'vitest'
import { createWorkspaceInfoMapper } from './workspace-info'

const workspaceRow = {
  id: 'workspace-1',
  name: 'Canvas workspace',
  root_path: '/tmp/projects/canvas-a',
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
  pinned_at: null,
  archived_at: null,
  worktree_meta_json: null,
}

describe('createWorkspaceInfoMapper', () => {
  it('marks a workspace by authoritative canvas project root path', () => {
    const mapWorkspaceInfo = createWorkspaceInfoMapper([
      { id: 'canvas-1', root_path: '/tmp/projects/./canvas-a' },
    ])

    expect(mapWorkspaceInfo(workspaceRow).canvasProjectId).toBe('canvas-1')
  })

  it('does not infer canvas origin from a workspace name', () => {
    const mapWorkspaceInfo = createWorkspaceInfoMapper([])

    expect(
      mapWorkspaceInfo({
        ...workspaceRow,
        name: 'looks-like-canvas_project_123',
      }).canvasProjectId,
    ).toBeNull()
  })
})
