import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CanvasWorkflowDefinition,
  CanvasWorkflowPackage,
  CanvasWorkflowRun,
} from '@spark/protocol'
import type { CanvasSnapshot } from './canvas.types'
import type { CanvasToolContext } from './canvas.tools'
import {
  CANVAS_WORKFLOW_TOOLS,
  executeCanvasWorkflowTool,
  getCanvasWorkflowToolSchemas,
} from './canvasWorkflowAgentTools'

const canvasWorkflowMocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  createRun: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  cancelRun: vi.fn(),
  retryRunStep: vi.fn(),
  resumeRun: vi.fn(),
}))

vi.mock('./canvasWorkflow.api', () => ({ canvasWorkflowApi: canvasWorkflowMocks }))

const at = '2026-07-24T00:00:00.000Z'

const workflowPackage: CanvasWorkflowPackage = {
  schemaVersion: 1,
  graph: { nodes: [], edges: [] },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: [], canvasNodeKinds: [] },
}

function workflow(overrides: Partial<CanvasWorkflowDefinition> = {}): CanvasWorkflowDefinition {
  return {
    id: 'canvas-workflow-1',
    projectId: 'project-1',
    name: '角色生成流',
    description: '测试工作流',
    scope: 'project',
    status: 'draft',
    version: 1,
    tags: ['角色'],
    package: workflowPackage,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

function snapshot(): CanvasSnapshot {
  return {
    project: {
      id: 'project-1',
      userId: 0,
      title: '测试项目',
      status: 'active',
      settings: {},
      nodeCount: 0,
      assetCount: 0,
      taskCount: 0,
      createdAt: at,
      updatedAt: at,
    },
    board: {
      id: 'board-1',
      projectId: 'project-1',
      userId: 0,
      name: '主画布',
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: {},
      createdAt: at,
      updatedAt: at,
    },
    activeBoardId: 'board-1',
    nodes: [],
    edges: [],
    assets: [],
    tasks: [],
  }
}

function context(overrides: Partial<CanvasToolContext> = {}): CanvasToolContext {
  return {
    projectId: 'project-1',
    getSnapshot: snapshot,
    workspace: {
      materializeWorkflow: vi.fn(async () => snapshot()),
      runCanvasWorkflow: vi.fn(),
    } as never,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  canvasWorkflowMocks.list.mockResolvedValue([workflow()])
  canvasWorkflowMocks.get.mockResolvedValue(workflow())
  canvasWorkflowMocks.create.mockResolvedValue(workflow())
  canvasWorkflowMocks.update.mockResolvedValue(workflow())
  canvasWorkflowMocks.delete.mockResolvedValue(true)
  canvasWorkflowMocks.createRun.mockResolvedValue({ run: { id: 'run-1' }, plan: { steps: [] } })
  canvasWorkflowMocks.listRuns.mockResolvedValue([])
  canvasWorkflowMocks.getRun.mockResolvedValue({ id: 'run-1', status: 'completed' })
  canvasWorkflowMocks.cancelRun.mockResolvedValue({ id: 'run-1', status: 'cancelled' })
  canvasWorkflowMocks.retryRunStep.mockResolvedValue({ id: 'run-1', status: 'queued' })
  canvasWorkflowMocks.resumeRun.mockResolvedValue({ run: { id: 'run-1' }, plan: { steps: [] } })
})

describe('canvas Agent workflow tools', () => {
  it('exposes only CanvasWorkflow tools in its own namespace', () => {
    const names = getCanvasWorkflowToolSchemas().map((tool) => tool.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'canvas_workflow_list',
        'canvas_workflow_get',
        'canvas_workflow_create',
        'canvas_workflow_update',
        'canvas_workflow_extract_selection',
        'canvas_workflow_delete',
        'canvas_workflow_apply',
        'canvas_workflow_run',
        'canvas_workflow_run_list',
        'canvas_workflow_run_get',
      ]),
    )
    expect(names.some((name) => name === 'workflow_list' || name.startsWith('app_workflow'))).toBe(
      false,
    )
  })

  it('lists only the current project plus library and builtin definitions', async () => {
    canvasWorkflowMocks.list.mockImplementation(async (request: Record<string, unknown>) => {
      if (request.scope === 'project') return [workflow()]
      if (request.scope === 'library') return [workflow({ id: 'library-1', projectId: null, scope: 'library' })]
      return [workflow({ id: 'builtin-1', projectId: null, scope: 'builtin' })]
    })
    const result = await executeCanvasWorkflowTool(context(), 'canvas_workflow_list', {})

    expect(canvasWorkflowMocks.list).toHaveBeenCalledTimes(3)
    expect(canvasWorkflowMocks.list).toHaveBeenCalledWith({
      scope: 'project',
      projectId: 'project-1',
      limit: 40,
      offset: 0,
    })
    expect(canvasWorkflowMocks.list).toHaveBeenCalledWith({ scope: 'library', limit: 40, offset: 0 })
    expect(canvasWorkflowMocks.list).toHaveBeenCalledWith({ scope: 'builtin', limit: 40, offset: 0 })
    expect(result).toMatchObject({
      workflows: expect.arrayContaining([
        expect.objectContaining({ id: 'canvas-workflow-1' }),
        expect.objectContaining({ id: 'library-1' }),
        expect.objectContaining({ id: 'builtin-1' }),
      ]),
      total: 3,
    })
  })

  it('rejects a project workflow from another canvas project', async () => {
    canvasWorkflowMocks.get.mockResolvedValue(workflow({ projectId: 'project-2' }))

    await expect(
      executeCanvasWorkflowTool(context(), 'canvas_workflow_get', { workflowId: 'canvas-workflow-1' }),
    ).rejects.toThrow('当前画布项目')
  })

  it('does not expose a run from another canvas project', async () => {
    canvasWorkflowMocks.getRun.mockResolvedValue({
      id: 'run-1',
      workflowId: 'canvas-workflow-1',
      projectId: 'project-2',
      status: 'completed',
      steps: [],
    })

    await expect(
      executeCanvasWorkflowTool(context(), 'canvas_workflow_run_get', { runId: 'run-1' }),
    ).rejects.toThrow('当前画布项目')
  })

  it('checks run ownership before resuming a run', async () => {
    canvasWorkflowMocks.getRun.mockResolvedValue({
      id: 'run-1',
      workflowId: 'canvas-workflow-1',
      projectId: 'project-2',
      status: 'paused',
      steps: [],
    })

    await expect(
      executeCanvasWorkflowTool(context(), 'canvas_workflow_run_resume', { runId: 'run-1' }),
    ).rejects.toThrow('当前画布项目')
    expect(canvasWorkflowMocks.resumeRun).not.toHaveBeenCalled()
  })

  it('returns a confirmation request before deleting a workflow', async () => {
    const result = await executeCanvasWorkflowTool(context(), 'canvas_workflow_delete', {
      workflowId: 'canvas-workflow-1',
    })

    expect(result).toMatchObject({ requiresConfirmation: true, action: 'delete_workflow' })
    expect(canvasWorkflowMocks.delete).not.toHaveBeenCalled()
  })

  it('deletes a workflow only after explicit confirmation', async () => {
    const result = await executeCanvasWorkflowTool(context(), 'canvas_workflow_delete', {
      workflowId: 'canvas-workflow-1',
      confirmed: true,
    })

    expect(canvasWorkflowMocks.delete).toHaveBeenCalledWith('canvas-workflow-1')
    expect(result).toEqual({ deleted: true, workflowId: 'canvas-workflow-1' })
  })

  it('materializes an independent graph only after confirmation', async () => {
    const workspace = context().workspace
    const result = await executeCanvasWorkflowTool(
      { ...context(), workspace },
      'canvas_workflow_apply',
      { workflowId: 'canvas-workflow-1', x: 120, y: 240 },
    )

    expect(result).toMatchObject({ requiresConfirmation: true, action: 'apply_workflow' })
    expect(workspace.materializeWorkflow).not.toHaveBeenCalled()
  })

  it('runs the persisted execution plan only after confirmation', async () => {
    const run = {
      id: 'run-1',
      workflowId: 'canvas-workflow-1',
      projectId: 'project-1',
      status: 'completed',
      workflowVersion: 1,
      inputs: {},
      exposedParams: {},
      outputs: {},
      error: null,
      idempotencyKey: 'test-run',
      steps: [],
      createdAt: at,
      startedAt: at,
      finishedAt: at,
      updatedAt: at,
    } as CanvasWorkflowRun
    const runCanvasWorkflow = vi.fn(async () => run)
    const result = await executeCanvasWorkflowTool(
      { ...context(), workspace: { runCanvasWorkflow } as never },
      'canvas_workflow_run',
      { workflowId: 'canvas-workflow-1', inputs: {}, exposedParams: {} },
    )

    expect(result).toMatchObject({ requiresConfirmation: true, action: 'run_workflow' })
    expect(canvasWorkflowMocks.createRun).not.toHaveBeenCalled()
    expect(runCanvasWorkflow).not.toHaveBeenCalled()

    const confirmed = await executeCanvasWorkflowTool(
      { ...context(), workspace: { runCanvasWorkflow } as never },
      'canvas_workflow_run',
      {
        workflowId: 'canvas-workflow-1',
        inputs: {},
        exposedParams: {},
        confirmed: true,
      },
    )

    expect(canvasWorkflowMocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'canvas-workflow-1', projectId: 'project-1' }),
    )
    expect(runCanvasWorkflow).toHaveBeenCalled()
    expect(confirmed).toMatchObject({ run: { id: 'run-1', status: 'completed' } })
  })
})

expect(CANVAS_WORKFLOW_TOOLS.length).toBeGreaterThan(0)
