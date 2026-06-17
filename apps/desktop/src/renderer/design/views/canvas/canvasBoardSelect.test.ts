import { describe, expect, it } from 'vitest'
import {
  readProjectBoards,
  resolveActiveBoard,
  snapshotFromDb,
  type CanvasDb,
} from './canvas.api'
import type { CanvasBoard, CanvasNode, CanvasProject } from './canvas.types'

function makeBoard(overrides: Partial<CanvasBoard>): CanvasBoard {
  return {
    id: 'board-1',
    projectId: 'project-1',
    userId: 0,
    name: 'Board 1',
    viewport: { x: 0, y: 0, zoom: 1 },
    settings: { grid: true },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeNode(overrides: Partial<CanvasNode>): CanvasNode {
  return {
    id: 'node-1',
    projectId: 'project-1',
    boardId: 'board-1',
    userId: 0,
    type: 'text',
    title: 'Node',
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    rotation: 0,
    zIndex: 1,
    locked: false,
    hidden: false,
    data: { text: 'hi' },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeProject(overrides: Partial<CanvasProject> = {}): CanvasProject {
  return {
    id: 'project-1',
    userId: 0,
    title: 'Project',
    status: 'active',
    nodeCount: 0,
    assetCount: 0,
    taskCount: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeDb(overrides: Partial<CanvasDb> = {}): CanvasDb {
  return {
    projects: [makeProject()],
    boards: [makeBoard({ id: 'board-1' })],
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
    ...overrides,
  }
}

describe('readProjectBoards', () => {
  it('returns only boards belonging to the project', () => {
    const db = makeDb({
      boards: [
        makeBoard({ id: 'b1', projectId: 'project-1' }),
        makeBoard({ id: 'b2', projectId: 'project-1' }),
        makeBoard({ id: 'b3', projectId: 'project-2' }),
      ],
    })
    const boards = readProjectBoards(db, 'project-1')
    expect(boards.map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('returns empty array when project has no boards', () => {
    const db = makeDb({ boards: [] })
    expect(readProjectBoards(db, 'project-1')).toEqual([])
  })
})

describe('resolveActiveBoard', () => {
  const b1 = makeBoard({ id: 'b1' })
  const b2 = makeBoard({ id: 'b2', settings: { grid: true, isDefault: true } })
  const b3 = makeBoard({ id: 'b3' })
  const boards = [b1, b2, b3]

  it('returns null when no boards', () => {
    expect(resolveActiveBoard([])).toBeNull()
  })

  it('prefers the explicit preferredBoardId', () => {
    const result = resolveActiveBoard(boards, 'b3')
    expect(result?.active.id).toBe('b3')
  })

  it('falls back to isDefault board when no preferred id', () => {
    const result = resolveActiveBoard(boards)
    expect(result?.active.id).toBe('b2')
  })

  it('falls back to first board when preferred id not found and no isDefault', () => {
    const noDefault = [makeBoard({ id: 'x1', settings: { grid: true } }), makeBoard({ id: 'x2', settings: { grid: true } })]
    const result = resolveActiveBoard(noDefault, 'nonexistent')
    expect(result?.active.id).toBe('x1')
  })
})

describe('snapshotFromDb', () => {
  it('filters nodes/edges by active board id', () => {
    const db = makeDb({
      boards: [
        makeBoard({ id: 'board-a' }),
        makeBoard({ id: 'board-b' }),
      ],
      nodes: [
        makeNode({ id: 'n1', boardId: 'board-a' }),
        makeNode({ id: 'n2', boardId: 'board-a' }),
        makeNode({ id: 'n3', boardId: 'board-b' }),
      ],
    })
    const snapshot = snapshotFromDb(db, 'project-1', 'board-a')
    expect(snapshot.board.id).toBe('board-a')
    expect(snapshot.activeBoardId).toBe('board-a')
    expect(snapshot.nodes.map((n) => n.id)).toEqual(['n1', 'n2'])
    expect(snapshot.boards?.map((b) => b.id)).toEqual(['board-a', 'board-b'])
  })

  it('returns all project nodes when active board has none (defensive fallback for legacy data)', () => {
    const db = makeDb({
      boards: [makeBoard({ id: 'board-new' })],
      // 旧数据：节点 boardId 指向已不存在的 board
      nodes: [
        makeNode({ id: 'legacy-1', boardId: 'old-board-id' }),
        makeNode({ id: 'legacy-2', boardId: 'old-board-id' }),
      ],
    })
    const snapshot = snapshotFromDb(db, 'project-1', 'board-new')
    // 兜底：board-new 无节点但项目有节点 → 显示全部，避免节点消失
    expect(snapshot.nodes.map((n) => n.id)).toEqual(['legacy-1', 'legacy-2'])
  })

  it('excludes hidden nodes', () => {
    const db = makeDb({
      nodes: [
        makeNode({ id: 'visible', boardId: 'board-1', hidden: false }),
        makeNode({ id: 'hidden', boardId: 'board-1', hidden: true }),
      ],
    })
    const snapshot = snapshotFromDb(db, 'project-1', 'board-1')
    expect(snapshot.nodes.map((n) => n.id)).toEqual(['visible'])
  })

  it('keeps assets project-scoped (not filtered by board)', () => {
    const db = makeDb({
      assets: [
        { id: 'a1', projectId: 'project-1', userId: 0, type: 'image', source: 'upload', metadata: {}, createdAt: '', updatedAt: '' },
        { id: 'a2', projectId: 'project-2', userId: 0, type: 'image', source: 'upload', metadata: {}, createdAt: '', updatedAt: '' },
      ],
    })
    const snapshot = snapshotFromDb(db, 'project-1', 'board-1')
    expect(snapshot.assets.map((a) => a.id)).toEqual(['a1'])
  })

  it('throws when project not found', () => {
    const db = makeDb()
    expect(() => snapshotFromDb(db, 'nonexistent', 'board-1')).toThrow('Canvas project not found')
  })
})
