import { describe, expect, it, vi } from 'vitest'
import type { CanvasProject, CanvasSnapshot } from '../canvas.types'
import { materializeCanvasAcceptanceRun } from './canvasAcceptanceProject'
import type { CanvasAcceptanceSelection } from './canvasAcceptanceTypes'

function emptySnapshot(projectId = 'project-1', boardId = 'board-1'): CanvasSnapshot {
  const at = '2026-07-18T00:00:00.000Z'
  return {
    project: {
      id: projectId,
      userId: 0,
      title: '🧪 无限画布验收实验室',
      status: 'active',
      nodeCount: 0,
      assetCount: 0,
      taskCount: 0,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: boardId,
      projectId,
      userId: 0,
      name: 'Main canvas',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
}

function selection(): CanvasAcceptanceSelection {
  return {
    suite: 'workflow_smoke',
    stageIds: ['W0_SOURCE', 'W1_SCREENPLAY'],
    textTarget: {
      kind: 'text',
      providerProfileId: 'text-provider',
      providerName: 'Text Provider',
      modelId: 'text-model',
      displayName: 'Text Model',
      capabilities: [],
    },
    verifyReload: true,
    verifyPreview: true,
  }
}

describe('canvas acceptance project materializer', () => {
  it('creates a dedicated project and real operation nodes without invoking providers', async () => {
    const snapshot = emptySnapshot()
    let nodeIndex = 0
    const api = {
      listProjects: vi.fn(async (): Promise<CanvasProject[]> => [snapshot.project]),
      createProject: vi.fn(async () => snapshot),
      openSnapshot: vi.fn(async () => snapshot),
      updateProjectMetadata: vi.fn(async () => snapshot),
      createBoard: vi.fn(async () => snapshot),
      renameBoard: vi.fn(async () => snapshot),
      setActiveBoard: vi.fn(async () => snapshot),
      createTextNode: vi.fn(async () => ({
        id: `text-${++nodeIndex}`,
        projectId: snapshot.project.id,
        boardId: snapshot.board.id,
        userId: 0,
        type: 'text' as const,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: {},
        createdAt: '',
        updatedAt: '',
      })),
      patchNodes: vi.fn(async () => snapshot),
      createOperationNode: vi.fn(async (input: { title?: string }) => {
        const currentNodeId = `operation-${++nodeIndex}`
        return {
          ...snapshot,
          nodes: [
            {
              id: 'old-operation',
              projectId: snapshot.project.id,
              boardId: 'old-board',
              userId: 0,
              type: 'text_rewrite' as const,
              title: input.title ?? null,
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              rotation: 0,
              zIndex: 1,
              locked: false,
              hidden: false,
              data: { operation: 'text_rewrite' as const },
              createdAt: '',
              updatedAt: '',
            },
            {
            id: currentNodeId,
            projectId: snapshot.project.id,
            boardId: snapshot.board.id,
            userId: 0,
            type: 'text_rewrite' as const,
            title: input.title ?? null,
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
            zIndex: 1,
            locked: false,
            hidden: false,
            data: { operation: 'text_rewrite' as const },
            createdAt: '',
            updatedAt: '',
            },
          ],
        }
      }),
    }
    const persist = vi.fn(async () => true)

    const result = await materializeCanvasAcceptanceRun({
      api,
      selection: selection(),
      persist,
      now: () => new Date('2026-07-18T00:00:00.000Z'),
      randomId: () => 'run-1',
    })

    expect(api.createProject).toHaveBeenCalledOnce()
    expect(api.renameBoard).toHaveBeenCalledWith(
      snapshot.project.id,
      snapshot.board.id,
      expect.stringContaining('workflow_smoke'),
    )
    expect(api.createOperationNode).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'text_rewrite',
        providerProfileId: 'text-provider',
        modelId: 'text-model',
      }),
    )
    expect(result.caseNodeIds['W1-SCREENPLAY']).toMatch(/^operation-/)
    expect(result.caseNodeIds['W1-SCREENPLAY']).not.toBe('old-operation')
    expect(api.updateProjectMetadata).toHaveBeenCalledWith(
      snapshot.project.id,
      expect.objectContaining({
        acceptanceRuns: [expect.objectContaining({ runId: 'acceptance_run-1' })],
      }),
    )
    expect(persist).toHaveBeenCalledOnce()
  })
})
