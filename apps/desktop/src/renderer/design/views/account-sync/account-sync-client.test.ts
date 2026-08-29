import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CanvasSnapshot } from '../canvas/canvas.types'
import { canvasApi } from '../canvas/canvas.api'
import {
  collectLatestProjectPromptLibraryItems,
  projectPromptLibraryItemsFromSnapshots,
} from './account-sync-client'

function snapshot(projectId: string, assetId: string, text: string): CanvasSnapshot {
  const now = '2026-08-30T00:00:00.000Z'
  return {
    project: {
      id: projectId,
      userId: 0,
      title: projectId,
      description: null,
      status: 'active',
      coverAssetId: null,
      coverUrl: null,
      pinned: false,
      pinnedAt: null,
      rootPath: null,
      lastOpenedAt: now,
      createdAt: now,
      updatedAt: now,
      metadata: {},
      nodeCount: 0,
      assetCount: 1,
      taskCount: 0,
    },
    board: {
      id: `board-${projectId}`,
      projectId,
      userId: 0,
      name: '默认画板',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { isDefault: true },
      createdAt: now,
      updatedAt: now,
    },
    boards: [],
    activeBoardId: `board-${projectId}`,
    nodes: [],
    edges: [],
    tasks: [],
    assets: [
      {
        id: assetId,
        projectId,
        userId: 0,
        type: 'prompt',
        source: 'manual',
        title: `${projectId} 提示词`,
        mimeType: 'text/plain',
        contentText: text,
        metadata: {
          kind: 'prompt_library',
          tags: ['镜头'],
          attributes: { promptCategory: '项目' },
        },
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
}

describe('projectPromptLibraryItemsFromSnapshots', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the project-qualified stable ids for every latest snapshot prompt', () => {
    const items = projectPromptLibraryItemsFromSnapshots([
      snapshot('project-1', 'prompt-1', '正文一'),
      snapshot('project-2', 'prompt-2', '正文二'),
    ])

    expect(items).toEqual([
      expect.objectContaining({
        id: 'legacy:project-1:prompt-1',
        text: '正文一',
        category: '项目',
        tags: ['镜头'],
      }),
      expect.objectContaining({ id: 'legacy:project-2:prompt-2', text: '正文二' }),
    ])
  })

  it('includes soft-deleted projects when collecting the latest prompt snapshots', async () => {
    const deletedSnapshot = snapshot('project-deleted', 'deleted-prompt', '保留的提示词')
    deletedSnapshot.project.status = 'deleted'
    const listProjects = vi
      .spyOn(canvasApi, 'listProjects')
      .mockResolvedValue([deletedSnapshot.project])
    vi.spyOn(canvasApi, 'openSnapshot').mockResolvedValue(deletedSnapshot)

    await expect(collectLatestProjectPromptLibraryItems()).resolves.toEqual([
      expect.objectContaining({
        id: 'legacy:project-deleted:deleted-prompt',
        text: '保留的提示词',
      }),
    ])
    expect(listProjects).toHaveBeenCalledWith(true)
  })

  it('falls back to persisted snapshots when the project list cannot be read', async () => {
    vi.spyOn(canvasApi, 'listProjects').mockRejectedValue(new Error('project list unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(collectLatestProjectPromptLibraryItems()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith(
      '[account-sync] prompt library project list unavailable; falling back to persisted snapshots',
    )
  })
})
