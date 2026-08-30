import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CanvasWorkflowRepository,
  CanvasWorkflowRow,
  CanvasWorkflowRunRepository,
  CanvasWorkflowRunRow,
  CanvasWorkflowRunStepRow,
  CanvasWorkflowVersionRepository,
  UpdateCanvasWorkflowRunParams,
} from '@spark/storage'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any) => Promise<any>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any) => Promise<any>) => {
    harness.handlers.set(channel, handler)
  },
}))

vi.mock('../db.js', () => ({
  getDatabase: vi.fn(),
}))

import { registerCanvasWorkflowIpc } from './registerCanvasWorkflowIpc.js'

const emptyPackage = {
  schemaVersion: 1 as const,
  graph: { nodes: [], edges: [] },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: [], canvasNodeKinds: [] },
}

const runnablePackage = {
  schemaVersion: 1 as const,
  graph: {
    nodes: [
      {
        id: 'generate',
        kind: 'canvas_operation' as const,
        label: '生成',
        position: { x: 0, y: 0 },
        config: { operation: 'text_to_image' },
      },
      {
        id: 'output',
        kind: 'canvas_output' as const,
        label: '输出',
        position: { x: 240, y: 0 },
        config: {},
      },
    ],
    edges: [{ id: 'edge-1', sourceNodeId: 'generate', targetNodeId: 'output' }],
  },
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: ['text_to_image'], canvasNodeKinds: ['operation'] },
}

function row(overrides: Partial<CanvasWorkflowRow> = {}): CanvasWorkflowRow {
  return {
    id: 'workflow-1',
    user_id: 0,
    project_id: null,
    name: '个人工作流',
    description: null,
    scope: 'library',
    status: 'draft',
    version: 1,
    tags_json: '[]',
    package_json: JSON.stringify(emptyPackage),
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
    ...overrides,
  }
}

function createRepository() {
  const current = row()
  return {
    list: vi.fn(() => [current]),
    listPage: vi.fn(() => ({ rows: [current], total: 1 })),
    get: vi.fn(() => current),
    create: vi.fn((input: any) =>
      row({
        id: input.id,
        project_id: input.projectId ?? null,
        name: input.name,
        scope: input.scope,
      }),
    ),
    update: vi.fn((_id: string, patch: any) => row({ status: patch.status ?? 'draft' })),
    duplicate: vi.fn((_id: string, input: any) =>
      row({
        id: input.id,
        name: input.name,
        scope: input.scope,
        project_id: input.projectId ?? null,
      }),
    ),
    delete: vi.fn(() => true),
    withTransaction: vi.fn((work: () => unknown) => work()),
    toItem: vi.fn((value: CanvasWorkflowRow) => ({
      id: value.id,
      userId: value.user_id,
      projectId: value.project_id,
      name: value.name,
      description: value.description,
      scope: value.scope,
      status: value.status,
      version: value.version,
      tags: JSON.parse(value.tags_json),
      package: JSON.parse(value.package_json),
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    })),
  }
}

function createVersionRepository() {
  return {
    create: vi.fn((input: any) => ({
      workflow_id: input.workflowId,
      version: input.version,
      name: input.name,
      package_json: JSON.stringify(input.packageJson),
      created_by_user_id: 0,
      created_at: input.createdAt ?? '2026-07-23T00:00:00.000Z',
    })),
    get: vi.fn((_workflowId: string, version: number) => ({
      workflow_id: 'workflow-1',
      version,
      name: '个人工作流',
      package_json: JSON.stringify(runnablePackage),
      created_by_user_id: 0,
      created_at: '2026-07-23T00:00:00.000Z',
    })),
    list: vi.fn(() => []),
  }
}

function createRunRepository() {
  const run: CanvasWorkflowRunRow = {
    id: 'run-1',
    workflow_id: 'workflow-1',
    workflow_version: 1,
    project_id: 'project-1',
    user_id: 0,
    status: 'queued' as const,
    inputs_json: '{}',
    exposed_params_json: '{}',
    outputs_json: '{}',
    error_json: null,
    idempotency_key: 'request-1',
    created_at: '2026-07-23T00:00:00.000Z',
    started_at: null,
    finished_at: null,
    updated_at: '2026-07-23T00:00:00.000Z',
  }
  return {
    create: vi.fn(() => run),
    get: vi.fn(() => run),
    getByIdempotencyKey: vi.fn((_key: string): typeof run | null => null),
    list: vi.fn(() => [run]),
    hasRunsForWorkflow: vi.fn(() => false),
    createSteps: vi.fn(),
    listSteps: vi.fn((_runId: string): CanvasWorkflowRunStepRow[] => []),
    getStep: vi.fn((_runId: string, _nodeId: string): CanvasWorkflowRunStepRow | null => null),
    updateStep: vi.fn(),
    releaseReadySteps: vi.fn(() => []),
    reconcileStatus: vi.fn(() => run),
    updateRun: vi.fn(
      (_id: string, _patch: UpdateCanvasWorkflowRunParams): CanvasWorkflowRunRow | null => run,
    ),
    cancel: vi.fn(() => ({ ...run, status: 'cancelled' as const })),
    retryFailedStep: vi.fn(),
    resume: vi.fn(() => ({ ...run, status: 'running' as const })),
    withTransaction: vi.fn((work: () => unknown) => work()),
  }
}

function registerWithRepositories(overrides: Record<string, unknown> = {}) {
  const repository = createRepository()
  const versionRepository = createVersionRepository()
  const runRepository = createRunRepository()
  registerCanvasWorkflowIpc({
    repository: repository as unknown as CanvasWorkflowRepository,
    versionRepository: versionRepository as unknown as CanvasWorkflowVersionRepository,
    runRepository: runRepository as unknown as CanvasWorkflowRunRepository,
    ...overrides,
  })
  return { repository, versionRepository, runRepository }
}

describe('registerCanvasWorkflowIpc', () => {
  beforeEach(() => {
    harness.handlers.clear()
  })

  it('registers the canvas workflow CRUD channels', () => {
    registerWithRepositories()

    expect([...harness.handlers.keys()].sort()).toEqual(
      [
        'canvas:workflow:archive',
        'canvas:workflow:create',
        'canvas:workflow:delete',
        'canvas:workflow:duplicate',
        'canvas:workflow:get',
        'canvas:workflow:list',
        'canvas:workflow:publish',
        'canvas:workflow:run:cancel',
        'canvas:workflow:run:create',
        'canvas:workflow:run:get',
        'canvas:workflow:run:list',
        'canvas:workflow:run:resume',
        'canvas:workflow:run:retry',
        'canvas:workflow:run:step-update',
        'canvas:workflow:update',
        'canvas:workflow:version:list',
      ].sort(),
    )
  })

  it('creates a project workflow with stable service-owned identity', async () => {
    const { repository, versionRepository } = registerWithRepositories({
      createId: () => 'created-id',
      now: () => '2026-07-23T10:00:00.000Z',
    })

    const response = await harness.handlers.get('canvas:workflow:create')!({
      name: '项目工作流',
      scope: 'project',
      projectId: 'project-1',
      package: emptyPackage,
    })

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'created-id',
        projectId: 'project-1',
        scope: 'project',
        createdAt: '2026-07-23T10:00:00.000Z',
      }),
    )
    expect(versionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: 'created-id', version: 1 }),
    )
    expect(response.workflow.id).toBe('created-id')
    expect(repository.withTransaction).toHaveBeenCalledTimes(1)
  })

  it('returns a paginated workflow page with a stable total', async () => {
    const { repository } = registerWithRepositories()

    const response = await harness.handlers.get('canvas:workflow:list')!({ limit: 30, offset: 0 })

    expect(repository.listPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 30, offset: 0 }),
    )
    expect(response).toMatchObject({ total: 1, hasMore: false })
    expect(response.workflows).toHaveLength(1)
  })

  it('copies a personal workflow into a project draft', async () => {
    const { repository } = registerWithRepositories({
      createId: () => 'project-copy',
    })

    const response = await harness.handlers.get('canvas:workflow:duplicate')!({
      id: 'workflow-1',
      targetScope: 'project',
      targetProjectId: 'project-1',
    })

    expect(repository.duplicate).toHaveBeenCalledWith(
      'workflow-1',
      expect.objectContaining({
        id: 'project-copy',
        scope: 'project',
        projectId: 'project-1',
      }),
    )
    expect(response.workflow.projectId).toBe('project-1')
  })

  it('blocks mutation of built-in templates', async () => {
    const { repository } = registerWithRepositories()
    repository.get.mockReturnValue(row({ scope: 'builtin' }))

    await expect(
      harness.handlers.get('canvas:workflow:delete')!({ id: 'workflow-1' }),
    ).rejects.toThrow(/内置模板/)
    expect(repository.delete).not.toHaveBeenCalled()
  })

  it('requires archiving instead of deleting a workflow with run history', async () => {
    const { repository, runRepository } = registerWithRepositories()
    runRepository.hasRunsForWorkflow.mockReturnValue(true)

    await expect(
      harness.handlers.get('canvas:workflow:delete')!({ id: 'workflow-1' }),
    ).rejects.toThrow(/运行历史.*归档/)
    expect(repository.delete).not.toHaveBeenCalled()
  })

  it('rejects a corrupted persisted package instead of casting it', async () => {
    const { repository } = registerWithRepositories()
    repository.toItem.mockReturnValue({
      ...repository.toItem(row()),
      package: { schemaVersion: 1, graph: null },
    })

    await expect(
      harness.handlers.get('canvas:workflow:get')!({ id: 'workflow-1' }),
    ).rejects.toThrow(/定义数据已损坏/)
  })

  it('blocks publishing an empty or semantically invalid graph', async () => {
    const { repository } = registerWithRepositories()
    repository.toItem.mockReturnValue({
      ...repository.toItem(row()),
      package: emptyPackage,
    })

    await expect(
      harness.handlers.get('canvas:workflow:publish')!({ id: 'workflow-1' }),
    ).rejects.toThrow(/至少需要一个节点/)
    expect(repository.update).not.toHaveBeenCalled()
  })

  it('compiles a version and creates ordered run steps', async () => {
    const { repository, runRepository } = registerWithRepositories({
      createId: vi
        .fn()
        .mockReturnValueOnce('run-1')
        .mockReturnValueOnce('step-1')
        .mockReturnValueOnce('step-2'),
      now: () => '2026-07-23T10:00:00.000Z',
    })
    repository.get.mockReturnValue(
      row({
        scope: 'project',
        project_id: 'project-1',
        package_json: JSON.stringify(runnablePackage),
      }),
    )
    repository.toItem.mockImplementation((value: CanvasWorkflowRow) => ({
      id: value.id,
      userId: value.user_id,
      projectId: value.project_id,
      name: value.name,
      description: value.description,
      scope: value.scope,
      status: value.status,
      version: value.version,
      tags: [],
      package: runnablePackage,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    }))

    const response = await harness.handlers.get('canvas:workflow:run:create')!({
      workflowId: 'workflow-1',
      projectId: 'project-1',
      inputs: {},
      exposedParams: {},
      idempotencyKey: 'request-1',
    })

    expect(response.plan.nodeOrder).toEqual(['generate', 'output'])
    expect(runRepository.createSteps).toHaveBeenCalledWith('run-1', [
      expect.objectContaining({ id: 'step-1', nodeId: 'generate', dependsOnNodeIds: [] }),
      expect.objectContaining({ id: 'step-2', nodeId: 'output', dependsOnNodeIds: ['generate'] }),
    ])
    expect(runRepository.withTransaction).toHaveBeenCalledTimes(1)
  })

  it('rebuilds an idempotent run plan from its immutable version snapshot', async () => {
    const { repository, versionRepository, runRepository } = registerWithRepositories()
    repository.toItem.mockReturnValue({
      ...repository.toItem(row()),
      package: emptyPackage,
    })
    runRepository.getByIdempotencyKey.mockReturnValue(runRepository.get())
    versionRepository.get.mockReturnValue({
      workflow_id: 'workflow-1',
      version: 1,
      name: '个人工作流',
      package_json: JSON.stringify(runnablePackage),
      created_by_user_id: 0,
      created_at: '2026-07-23T00:00:00.000Z',
    })

    const response = await harness.handlers.get('canvas:workflow:run:create')!({
      workflowId: 'workflow-1',
      projectId: 'project-1',
      inputs: {},
      exposedParams: {},
      idempotencyKey: 'request-1',
    })

    expect(response.run.id).toBe('run-1')
    expect(response.plan.nodeOrder).toEqual(['generate', 'output'])
    expect(runRepository.create).not.toHaveBeenCalled()
  })

  it('creates a run from an explicitly pinned workflow version', async () => {
    const { repository, versionRepository, runRepository } = registerWithRepositories({
      createId: vi
        .fn()
        .mockReturnValueOnce('run-pinned')
        .mockReturnValueOnce('step-1')
        .mockReturnValueOnce('step-2'),
    })
    repository.get.mockReturnValue(
      row({
        version: 2,
        scope: 'project',
        project_id: 'project-1',
        package_json: JSON.stringify(emptyPackage),
      }),
    )
    repository.toItem.mockImplementation((value: CanvasWorkflowRow) => ({
      id: value.id,
      userId: value.user_id,
      projectId: value.project_id,
      name: value.name,
      description: value.description,
      scope: value.scope,
      status: value.status,
      version: value.version,
      tags: [],
      package: emptyPackage,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    }))
    versionRepository.get.mockReturnValue({
      workflow_id: 'workflow-1',
      version: 1,
      name: '历史版本',
      package_json: JSON.stringify(runnablePackage),
      created_by_user_id: 0,
      created_at: '2026-07-22T00:00:00.000Z',
    })

    const response = await harness.handlers.get('canvas:workflow:run:create')!({
      workflowId: 'workflow-1',
      workflowVersion: 1,
      projectId: 'project-1',
      inputs: {},
      exposedParams: {},
      idempotencyKey: 'pinned-request',
    })

    expect(response.plan.nodeOrder).toEqual(['generate', 'output'])
    expect(runRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ workflowVersion: 1 }),
    )
  })

  it('returns the immutable execution plan when resuming a historical run', async () => {
    const { runRepository } = registerWithRepositories()

    const response = await harness.handlers.get('canvas:workflow:run:resume')!({ id: 'run-1' })

    expect(response.run.status).toBe('running')
    expect(response.plan.nodeOrder).toEqual(['generate', 'output'])
    expect(runRepository.resume).toHaveBeenCalledWith('run-1', expect.any(String))
  })

  it('validates required run inputs in the main process', async () => {
    const requiredInputPackage = {
      ...runnablePackage,
      contract: {
        inputs: [
          {
            id: 'theme',
            name: '创作主题',
            valueType: 'text' as const,
            required: true,
            targetNodeId: 'generate',
          },
        ],
        outputs: [],
        exposedParams: [],
      },
    }
    const { repository, runRepository } = registerWithRepositories()
    repository.get.mockReturnValue(
      row({
        scope: 'project',
        project_id: 'project-1',
        package_json: JSON.stringify(requiredInputPackage),
      }),
    )
    repository.toItem.mockImplementation((value: CanvasWorkflowRow) => ({
      id: value.id,
      userId: value.user_id,
      projectId: value.project_id,
      name: value.name,
      description: value.description,
      scope: value.scope,
      status: value.status,
      version: value.version,
      tags: [],
      package: requiredInputPackage,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    }))

    await expect(
      harness.handlers.get('canvas:workflow:run:create')!({
        workflowId: 'workflow-1',
        projectId: 'project-1',
        inputs: {},
        exposedParams: {},
        idempotencyKey: 'request-required',
      }),
    ).rejects.toThrow(/创作主题/)
    expect(runRepository.create).not.toHaveBeenCalled()
  })

  it('projects completed step outputs through each output source handle', async () => {
    const outputPackage = {
      ...runnablePackage,
      contract: {
        inputs: [],
        exposedParams: [],
        outputs: [
          {
            id: 'generated-nodes',
            name: '生成节点',
            valueType: 'node' as const,
            sourceNodeId: 'generate',
            sourceHandle: 'outputNodeIds',
          },
          {
            id: 'generated-assets',
            name: '生成资产',
            valueType: 'asset' as const,
            sourceNodeId: 'generate',
            sourceHandle: 'outputAssetIds',
          },
        ],
      },
    }
    const { versionRepository, runRepository } = registerWithRepositories()
    const completedRun = {
      ...runRepository.get(),
      status: 'completed' as const,
    }
    versionRepository.get.mockReturnValue({
      workflow_id: 'workflow-1',
      version: 1,
      name: '生成工作流',
      package_json: JSON.stringify(outputPackage),
      created_by_user_id: 0,
      created_at: '2026-07-23T00:00:00.000Z',
    })
    runRepository.getStep.mockReturnValue({
      id: 'step-generate',
      run_id: 'run-1',
      node_id: 'generate',
      step_index: 0,
      status: 'running',
      depends_on_json: '[]',
      task_id: 'task-1',
      input_json: '{}',
      output_json: null,
      error_json: null,
      attempt: 1,
      started_at: '2026-07-23T00:00:00.000Z',
      finished_at: null,
      updated_at: '2026-07-23T00:00:00.000Z',
    })
    runRepository.reconcileStatus.mockReturnValue(completedRun)
    runRepository.listSteps.mockReturnValue([
      {
        ...runRepository.getStep('run-1', 'generate')!,
        status: 'completed' as const,
        output_json: JSON.stringify({
          outputNodeIds: ['node-1'],
          outputAssetIds: ['asset-1'],
        }),
      },
    ])
    runRepository.updateRun.mockImplementation(
      (_id: string, patch: UpdateCanvasWorkflowRunParams) => ({
        ...completedRun,
        outputs_json: JSON.stringify(patch.outputsJson ?? {}),
      }),
    )

    await harness.handlers.get('canvas:workflow:run:step-update')!({
      runId: 'run-1',
      nodeId: 'generate',
      status: 'completed',
      output: {
        outputNodeIds: ['node-1'],
        outputAssetIds: ['asset-1'],
      },
    })

    expect(runRepository.updateRun).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        outputsJson: {
          'generated-nodes': ['node-1'],
          'generated-assets': ['asset-1'],
        },
      }),
    )
  })
})
