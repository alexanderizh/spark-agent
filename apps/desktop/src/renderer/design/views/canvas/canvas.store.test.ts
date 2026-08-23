import { describe, expect, it } from 'vitest'
import {
  boardHistorySignature,
  createCanvasProjectListStore,
  createHistoryEntry,
  mergeCanvasBackgroundTaskSnapshot,
  mergeCanvasMutationSnapshot,
  mergeCanvasTaskSnapshot,
  resolveCanvasTaskExecutionMethod,
  shouldRefreshCanvasProjectsForTaskStream,
} from './canvas.store'
import type { CanvasProject, CanvasSnapshot } from './canvas.types'

function makeProject(id: string): CanvasProject {
  return {
    id,
    userId: 0,
    title: id,
    status: 'active',
    nodeCount: 0,
    assetCount: 0,
    taskCount: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    lastOpenedAt: '2026-06-01T00:00:00.000Z',
  }
}

describe('createCanvasProjectListStore', () => {
  it('publishes a refreshed project list to every subscriber', async () => {
    let projects = [makeProject('project-1'), makeProject('project-2')]
    const store = createCanvasProjectListStore(async () => projects)
    const firstSubscriber: string[][] = []
    const secondSubscriber: string[][] = []
    const unsubscribeFirst = store.subscribe(() => {
      firstSubscriber.push(store.getSnapshot().projects.map((project) => project.id))
    })
    const unsubscribeSecond = store.subscribe(() => {
      secondSubscriber.push(store.getSnapshot().projects.map((project) => project.id))
    })

    await store.refresh()
    projects = [makeProject('project-2')]
    await store.refresh()

    expect(firstSubscriber.at(-1)).toEqual(['project-2'])
    expect(secondSubscriber.at(-1)).toEqual(['project-2'])
    unsubscribeFirst()
    unsubscribeSecond()
  })

  it('does not let an older refresh overwrite a newer project list', async () => {
    let resolveFirst: ((projects: CanvasProject[]) => void) | undefined
    const first = new Promise<CanvasProject[]>((resolve) => {
      resolveFirst = resolve
    })
    let calls = 0
    const store = createCanvasProjectListStore(() => {
      calls += 1
      return calls === 1 ? first : Promise.resolve([makeProject('project-2')])
    })

    const staleRefresh = store.refresh()
    await store.refresh()
    resolveFirst?.([makeProject('project-1')])
    await staleRefresh

    expect(store.getSnapshot()).toEqual({
      projects: [makeProject('project-2')],
      loading: false,
    })
  })
})

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

describe('mergeCanvasBackgroundTaskSnapshot', () => {
  it('does not switch boards when a background task from another board finishes', () => {
    const current = makeSnapshot({
      nodes: makeSnapshot().nodes.filter((node) => node.boardId === 'board-1'),
    })
    const next = makeSnapshot({
      board: {
        ...makeSnapshot().board,
        id: 'board-2',
        name: 'Board 2',
      },
      activeBoardId: 'board-2',
      nodes: [
        {
          ...makeSnapshot().nodes[0]!,
          id: 'node-board-2',
          boardId: 'board-2',
        },
      ],
      tasks: [
        {
          ...makeSnapshot().tasks[0]!,
          id: 'task-board-2',
          boardId: 'board-2',
          status: 'completed',
          progress: 100,
        },
      ],
      assets: [
        ...makeSnapshot().assets,
        {
          ...makeSnapshot().assets[0]!,
          id: 'asset-board-2',
          title: 'Board 2 output',
        },
      ],
    })

    const merged = mergeCanvasBackgroundTaskSnapshot(current, next)

    expect(merged.activeBoardId).toBe('board-1')
    expect(merged.board.id).toBe('board-1')
    expect(merged.nodes.some((node) => node.boardId === 'board-2')).toBe(false)
    expect(merged.tasks.some((task) => task.boardId === 'board-2')).toBe(false)
    expect(merged.assets.some((asset) => asset.id === 'asset-board-2')).toBe(true)
  })

  it('preserves current nodes, assets, tasks, and edges missing from an async task snapshot', () => {
    const current = makeSnapshot({
      nodes: [
        ...makeSnapshot().nodes,
        {
          id: 'generated-node',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          type: 'image',
          title: 'Generated',
          assetId: 'generated-asset',
          taskId: 'generated-task',
          x: 240,
          y: 20,
          width: 320,
          height: 180,
          rotation: 0,
          zIndex: 2,
          locked: false,
          hidden: false,
          data: { origin: 'task_output' },
          createdAt: '2026-06-01T00:01:00.000Z',
          updatedAt: '2026-06-01T00:01:00.000Z',
        },
      ],
      edges: [
        {
          id: 'generated-edge',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          sourceNodeId: 'node-1',
          targetNodeId: 'generated-node',
          type: 'generated',
          taskId: 'generated-task',
          metadata: {},
          createdAt: '2026-06-01T00:01:00.000Z',
        },
      ],
      assets: [
        ...makeSnapshot().assets,
        {
          id: 'generated-asset',
          projectId: 'project-1',
          userId: 0,
          type: 'image',
          source: 'ai_generated',
          title: 'Generated asset',
          url: 'safe-file://generated',
          metadata: { taskId: 'generated-task' },
          createdAt: '2026-06-01T00:01:00.000Z',
          updatedAt: '2026-06-01T00:01:00.000Z',
        },
      ],
      tasks: [
        ...makeSnapshot().tasks,
        {
          id: 'generated-task',
          projectId: 'project-1',
          boardId: 'board-1',
          userId: 0,
          operation: 'text_to_image',
          status: 'completed',
          progress: 100,
          title: 'Generated task',
          prompt: 'prompt',
          negativePrompt: null,
          inputNodeIds: ['node-1'],
          inputAssetIds: [],
          outputNodeIds: ['generated-node'],
          outputAssetIds: ['generated-asset'],
          modelParams: {},
          createdAt: '2026-06-01T00:01:00.000Z',
          updatedAt: '2026-06-01T00:01:00.000Z',
        },
      ],
    })
    const staleNext = makeSnapshot({
      nodes: makeSnapshot().nodes.map((node) =>
        node.id === 'node-1' ? { ...node, x: 88, updatedAt: '2026-06-01T00:02:00.000Z' } : node,
      ),
    })

    const merged = mergeCanvasBackgroundTaskSnapshot(current, staleNext)

    expect(merged.nodes.find((node) => node.id === 'node-1')?.x).toBe(88)
    expect(merged.nodes.some((node) => node.id === 'generated-node')).toBe(true)
    expect(merged.assets.some((asset) => asset.id === 'generated-asset')).toBe(true)
    expect(merged.tasks.some((task) => task.id === 'generated-task')).toBe(true)
    expect(merged.edges.some((edge) => edge.id === 'generated-edge')).toBe(true)
  })

  it('keeps the active board viewport and unchanged entity references', () => {
    const current = makeSnapshot({
      board: {
        ...makeSnapshot().board,
        viewport: { x: -420, y: 180, zoom: 0.72 },
      },
    })
    const next = makeSnapshot({
      board: { ...makeSnapshot().board, viewport: { x: 0, y: 0, zoom: 1 } },
      tasks: current.tasks.map((task) => ({
        ...task,
        status: 'running' as const,
        progress: 30,
        updatedAt: '2026-06-01T00:02:00.000Z',
      })),
      nodes: current.nodes.map((node) =>
        node.id === 'node-1'
          ? {
              ...node,
              data: { ...node.data, status: 'running' as const },
              updatedAt: '2026-06-01T00:02:00.000Z',
            }
          : { ...node },
      ),
    })

    const merged = mergeCanvasBackgroundTaskSnapshot(current, next)

    expect(merged.board.viewport).toEqual({ x: -420, y: 180, zoom: 0.72 })
    expect(merged.nodes.find((node) => node.id === 'node-1')?.data.status).toBe('running')
    expect(merged.nodes.find((node) => node.id === 'node-other-board')).toBe(current.nodes[1])
  })

  it('does not let an older running snapshot replace a newer completed task state', () => {
    const current = makeSnapshot({
      nodes: makeSnapshot().nodes.map((node) =>
        node.id === 'node-1'
          ? {
              ...node,
              data: { ...node.data, status: 'completed' as const, progress: 100 },
              updatedAt: '2026-06-01T00:03:00.000Z',
            }
          : node,
      ),
      tasks: makeSnapshot().tasks.map((task) => ({
        ...task,
        status: 'completed' as const,
        progress: 100,
        updatedAt: '2026-06-01T00:03:00.000Z',
      })),
    })
    const staleRunning = makeSnapshot({
      nodes: makeSnapshot().nodes.map((node) =>
        node.id === 'node-1'
          ? {
              ...node,
              data: { ...node.data, status: 'running' as const, progress: 60 },
              updatedAt: '2026-06-01T00:02:00.000Z',
            }
          : node,
      ),
      tasks: makeSnapshot().tasks.map((task) => ({
        ...task,
        status: 'running' as const,
        progress: 60,
        updatedAt: '2026-06-01T00:02:00.000Z',
      })),
    })

    const merged = mergeCanvasBackgroundTaskSnapshot(current, staleRunning)

    expect(merged.nodes.find((node) => node.id === 'node-1')?.data.status).toBe('completed')
    expect(merged.tasks.find((task) => task.id === 'task-1')?.status).toBe('completed')
  })

  it('accepts a newer running state when the same node starts another execution', () => {
    const current = makeSnapshot({
      nodes: makeSnapshot().nodes.map((node) =>
        node.id === 'node-1'
          ? {
              ...node,
              taskId: 'task-1',
              data: { ...node.data, status: 'completed' as const, progress: 100 },
              updatedAt: '2026-06-01T00:03:00.000Z',
            }
          : node,
      ),
      tasks: makeSnapshot().tasks.map((task) => ({
        ...task,
        status: 'completed' as const,
        progress: 100,
        updatedAt: '2026-06-01T00:03:00.000Z',
      })),
    })
    const rerun = makeSnapshot({
      nodes: makeSnapshot().nodes.map((node) =>
        node.id === 'node-1'
          ? {
              ...node,
              taskId: 'task-2',
              data: { ...node.data, status: 'running' as const, progress: 10 },
              updatedAt: '2026-06-01T00:04:00.000Z',
            }
          : node,
      ),
      tasks: makeSnapshot().tasks.map((task) => ({
        ...task,
        id: 'task-2',
        status: 'running' as const,
        progress: 10,
        updatedAt: '2026-06-01T00:04:00.000Z',
      })),
    })

    const merged = mergeCanvasBackgroundTaskSnapshot(current, rerun)
    const operationNode = merged.nodes.find((node) => node.id === 'node-1')

    expect(operationNode?.taskId).toBe('task-2')
    expect(operationNode?.data.status).toBe('running')
    expect(merged.tasks.find((task) => task.id === 'task-2')?.status).toBe('running')
    expect(merged.tasks.find((task) => task.id === 'task-1')?.status).toBe('completed')
  })

  it('preserves the viewport while honoring structural deletions', () => {
    const current = makeSnapshot({
      board: {
        ...makeSnapshot().board,
        viewport: { x: -120, y: 64, zoom: 0.9 },
      },
    })
    const next = makeSnapshot({
      board: { ...makeSnapshot().board, viewport: { x: 0, y: 0, zoom: 1 } },
      nodes: [makeSnapshot().nodes[0]!],
    })

    const merged = mergeCanvasMutationSnapshot(current, next)

    expect(merged.board.viewport).toEqual({ x: -120, y: 64, zoom: 0.9 })
    expect(merged.nodes).toHaveLength(1)
    expect(merged.nodes[0]?.id).toBe('node-1')
  })
})

describe('mergeCanvasTaskSnapshot', () => {
  it('honors an authoritative task deletion when a node starts a replacement run', () => {
    const baseTask = makeSnapshot().tasks[0]
    if (!baseTask) throw new Error('test snapshot must include a task')
    const current = makeSnapshot({
      board: {
        ...makeSnapshot().board,
        viewport: { x: -120, y: 64, zoom: 0.9 },
      },
      nodes: makeSnapshot().nodes.map((node) =>
        node.id === 'node-1' ? { ...node, taskId: 'task-old' } : node,
      ),
      tasks: [
        {
          ...baseTask,
          id: 'task-old',
          status: 'running',
          operationNodeId: 'node-1',
        },
      ],
    })
    const next = makeSnapshot({
      board: { ...makeSnapshot().board, viewport: { x: 0, y: 0, zoom: 1 } },
      nodes: makeSnapshot().nodes.map((node) =>
        node.id === 'node-1'
          ? {
              ...node,
              taskId: 'task-new',
              updatedAt: '2026-06-01T00:02:00.000Z',
            }
          : node,
      ),
      tasks: [
        {
          ...baseTask,
          id: 'task-new',
          status: 'running',
          operationNodeId: 'node-1',
          updatedAt: '2026-06-01T00:02:00.000Z',
        },
      ],
    })

    const merged = mergeCanvasTaskSnapshot(current, next)

    expect(merged.board.viewport).toEqual({ x: -120, y: 64, zoom: 0.9 })
    expect(merged.tasks.map((task) => task.id)).toEqual(['task-new'])
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

describe('resolveCanvasTaskExecutionMethod', () => {
  it('routes local depth video tasks to the local runner', () => {
    expect(resolveCanvasTaskExecutionMethod('video_depth_map')).toBe('local_depth')
  })

  it('preserves the existing text and cloud media routes', () => {
    expect(resolveCanvasTaskExecutionMethod('image_prompt_reverse')).toBe('text')
    expect(resolveCanvasTaskExecutionMethod('image_to_video')).toBe('cloud_media')
  })
})
