import { describe, expect, it } from 'vitest'
import {
  boardHistorySignature,
  createHistoryEntry,
  shouldRefreshCanvasProjectsForTaskStream,
} from './canvas.store'
import type { CanvasSnapshot } from './canvas.types'

function makeSnapshot(overrides: Partial<CanvasSnapshot> = {}): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: 'Project',
      status: 'active',
      nodeCount: 1,
      assetCount: 1,
      taskCount: 1,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
      lastOpenedAt: '2026-06-01T00:00:00.000Z',
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: 'Board 1',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { grid: true },
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
    boards: [],
    activeBoardId: 'board-1',
    nodes: [
      {
        id: 'node-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        type: 'text',
        title: 'Node 1',
        x: 10,
        y: 20,
        width: 200,
        height: 120,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { text: 'hello' },
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'node-other-board',
        projectId: 'project-1',
        boardId: 'board-2',
        userId: 0,
        type: 'text',
        title: 'Other board',
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { text: 'ignored' },
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    edges: [],
    assets: [
      {
        id: 'asset-1',
        projectId: 'project-1',
        userId: 0,
        type: 'text',
        source: 'upload',
        title: 'Asset',
        contentText: 'asset text',
        url: null,
        metadata: {},
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    tasks: [
      {
        id: 'task-1',
        projectId: 'project-1',
        boardId: 'board-1',
        userId: 0,
        operation: 'text_generate',
        status: 'pending',
        progress: 10,
        title: 'Task',
        prompt: 'prompt',
        negativePrompt: null,
        inputNodeIds: ['node-1'],
        inputAssetIds: [],
        outputNodeIds: [],
        outputAssetIds: [],
        modelParams: {},
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

describe('boardHistorySignature', () => {
  it('ignores volatile project timestamps and nodes from other boards', () => {
    const first = makeSnapshot()
    const second = makeSnapshot({
      project: { ...first.project, lastOpenedAt: '2026-06-02T00:00:00.000Z' },
      nodes: first.nodes.map((node) =>
        node.boardId === 'board-2' ? { ...node, x: node.x + 100, data: { text: 'changed' } } : node,
      ),
    })

    expect(boardHistorySignature(second)).toEqual(boardHistorySignature(first))
  })

  it('detects active-board node edits', () => {
    const first = makeSnapshot()
    const second = makeSnapshot({
      nodes: first.nodes.map((node) => (node.id === 'node-1' ? { ...node, x: 42 } : node)),
    })

    expect(boardHistorySignature(second)).not.toEqual(boardHistorySignature(first))
  })
})

describe('createHistoryEntry', () => {
  it('deep-clones the snapshot so later mutations cannot corrupt undo entries', () => {
    const snapshot = makeSnapshot()
    const entry = createHistoryEntry(snapshot)
    snapshot.nodes[0]!.x = 999
    snapshot.assets[0]!.contentText = 'mutated'

    expect(entry.snapshot.nodes[0]?.x).toBe(10)
    expect(entry.snapshot.assets[0]?.contentText).toBe('asset text')
  })
})

describe('shouldRefreshCanvasProjectsForTaskStream', () => {
  it('ignores running media task events because list metadata has not settled yet', () => {
    expect(
      shouldRefreshCanvasProjectsForTaskStream({
        projectId: 'project-1',
        clientTaskId: 'task-1',
        runtimeTaskId: 'runtime-1',
        status: 'running',
        response: {} as never,
      }),
    ).toBe(false)
  })

  it('refreshes after media and text task terminal events', () => {
    expect(
      shouldRefreshCanvasProjectsForTaskStream({
        projectId: 'project-1',
        clientTaskId: 'task-1',
        runtimeTaskId: 'runtime-1',
        status: 'succeeded',
        response: {} as never,
      }),
    ).toBe(true)
    expect(
      shouldRefreshCanvasProjectsForTaskStream({
        projectId: 'project-1',
        clientTaskId: 'task-2',
        status: 'failed',
        response: {} as never,
      }),
    ).toBe(true)
  })
})
