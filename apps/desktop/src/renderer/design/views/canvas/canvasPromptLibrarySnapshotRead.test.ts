// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetCanvasHotCache, canvasApi, type CanvasDb } from './canvas.api'
import type { CanvasSnapshot } from './canvas.types'

const STORAGE_KEY = 'spark-canvas:v1'
const at = '2026-08-30T00:00:00.000Z'

function snapshot(projectId: string): CanvasSnapshot {
  const project = {
    id: projectId,
    userId: 0,
    title: projectId,
    status: 'active' as const,
    settings: {},
    nodeCount: 0,
    assetCount: 1,
    taskCount: 0,
    createdAt: at,
    updatedAt: at,
  }
  const board = {
    id: `${projectId}-board`,
    projectId,
    userId: 0,
    name: 'Board',
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: {},
    createdAt: at,
    updatedAt: at,
  }
  return {
    project,
    board,
    boards: [board],
    activeBoardId: board.id,
    nodes: [],
    edges: [],
    assets: [
      {
        id: `${projectId}-prompt`,
        projectId,
        userId: 0,
        type: 'prompt',
        source: 'manual',
        title: `${projectId} prompt`,
        contentText: `${projectId} text`,
        metadata: { kind: 'prompt_library' },
        createdAt: at,
        updatedAt: at,
      },
    ],
    tasks: [],
  }
}

function dbFromSnapshots(snapshots: CanvasSnapshot[]): CanvasDb {
  return {
    projects: snapshots.map((item) => item.project),
    boards: snapshots.flatMap((item) => item.boards ?? [item.board]),
    nodes: snapshots.flatMap((item) => item.nodes),
    edges: snapshots.flatMap((item) => item.edges),
    assets: snapshots.flatMap((item) => item.assets),
    tasks: snapshots.flatMap((item) => item.tasks),
  }
}

describe('canvas prompt library cross-project snapshots', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetCanvasHotCache()
  })

  it('keeps every project in the shared cache while loading prompt assets concurrently', async () => {
    const snapshots = [snapshot('project-a'), snapshot('project-b')]
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dbFromSnapshots(snapshots)))
    __resetCanvasHotCache()

    Object.assign(window, {
      spark: {
        invoke: vi.fn(async (channel: string, request: unknown) => {
          if (channel === 'canvas:snapshot:load') {
            const projectId = (request as { projectId: string }).projectId
            const selected = snapshots.find((item) => item.project.id === projectId)
            return { snapshotJson: selected ? JSON.stringify(selected) : null }
          }
          if (channel === 'canvas:project:list') throw new Error('use hot cache fallback')
          return {}
        }),
      },
    })

    const loaded = await Promise.all(
      snapshots.map((item) => canvasApi.openSnapshot(item.project.id)),
    )

    expect(loaded.flatMap((item) => item.assets).map((asset) => asset.id)).toEqual([
      'project-a-prompt',
      'project-b-prompt',
    ])
    await expect(canvasApi.listProjects()).resolves.toHaveLength(2)
  })
})
