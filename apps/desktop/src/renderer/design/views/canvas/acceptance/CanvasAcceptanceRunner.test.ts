import { describe, expect, it, vi } from 'vitest'
import type { CanvasSnapshot } from '../canvas.types'
import {
  resolveAcceptanceRuntimeInputNodeIds,
  runCanvasAcceptancePlan,
} from './CanvasAcceptanceRunner'
import type { CanvasAcceptanceCasePlan, CanvasAcceptancePlan } from './canvasAcceptanceTypes'

const casePlan = (
  caseId: string,
  dependsOnCaseIds: string[] = [],
): CanvasAcceptanceCasePlan => ({
  caseId,
  stageId: 'W1_SCREENPLAY',
  nodeRef: caseId,
  title: caseId,
  operation: 'text_rewrite',
  targetKind: 'text',
  dependsOnCaseIds,
  target: {
    kind: 'text',
    providerProfileId: 'provider-1',
    providerName: 'Provider',
    modelId: 'model-1',
    displayName: 'Model',
    capabilities: [],
  },
  blockedReasons: [],
  expectedEvidence: [],
})

function snapshot(status: 'pending' | 'running' | 'completed' | 'failed'): CanvasSnapshot {
  const taskId = 'task-1'
  return {
    project: {
      id: 'project-1', userId: 0, title: '验收', status: 'active',
      metadata: {
        projectKind: 'acceptance',
        latestAcceptanceRun: {
          runId: 'run-1',
          boardId: 'board-1',
          caseNodeIds: { CASE_A: 'node-1' },
          plan: { cases: [casePlan('CASE_A')] },
        },
      },
      nodeCount: status === 'completed' ? 2 : 1,
      assetCount: status === 'completed' ? 1 : 0,
      taskCount: 1, createdAt: '', updatedAt: '',
    },
    board: {
      id: 'board-1', projectId: 'project-1', userId: 0, name: 'run',
      viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, createdAt: '', updatedAt: '',
    },
    nodes: [
      {
        id: 'node-1', projectId: 'project-1', boardId: 'board-1', userId: 0,
        type: 'text_rewrite', taskId, x: 0, y: 0, width: 100, height: 100,
        rotation: 0, zIndex: 1, locked: false, hidden: false,
        data: { operation: 'text_rewrite', prompt: 'prompt', providerProfileId: 'provider-1', modelId: 'model-1' },
        createdAt: '', updatedAt: '',
      },
      ...(status === 'completed'
        ? [{
            id: 'output-1', projectId: 'project-1', boardId: 'board-1', userId: 0,
            type: 'text' as const, assetId: 'asset-1', x: 200, y: 0, width: 100, height: 100,
            rotation: 0, zIndex: 2, locked: false, hidden: false, data: {},
            createdAt: '', updatedAt: '',
          }]
        : []),
    ],
    edges: [],
    assets: status === 'completed'
      ? [{
          id: 'asset-1', projectId: 'project-1', userId: 0, type: 'text',
          source: 'ai_generated', contentText: 'output', metadata: {},
          createdAt: '', updatedAt: '',
        }]
      : [],
    tasks: [{
      id: taskId, projectId: 'project-1', boardId: 'board-1', userId: 0,
      operation: 'text_rewrite', status, progress: status === 'completed' ? 100 : 0,
      title: 'CASE_A', operationNodeId: 'node-1', inputNodeIds: [], inputAssetIds: [],
      outputNodeIds: status === 'completed' ? ['output-1'] : [],
      outputAssetIds: status === 'completed' ? ['asset-1'] : [],
      providerProfileId: 'provider-1', modelId: 'model-1', modelParams: {},
      modelOutputText: status === 'completed' ? 'output' : null,
      rawResponse: status === 'completed' ? { ok: true } : null,
      runtimeEvents: [{ at: '', kind: status === 'completed' ? 'completed' : 'created', label: status }],
      createdAt: '', updatedAt: '',
    }],
  }
}

function acceptancePlan(
  cases: CanvasAcceptanceCasePlan[],
  runId = 'run-1',
): CanvasAcceptancePlan {
  return {
    runId,
    suite: 'workflow_smoke',
    fixtureVersion: 'fixture-1',
    createdAt: '',
    selectedStageIds: ['W1_SCREENPLAY'],
    cases,
    executableCaseCount: cases.filter((item) => item.blockedReasons.length === 0).length,
    blockedCaseCount: cases.filter((item) => item.blockedReasons.length > 0).length,
    highCostCaseCount: 0,
    verifyReload: false,
    verifyPreview: false,
  }
}

describe('CanvasAcceptanceRunner', () => {
  it('runs a pending real operation and waits for its terminal task', async () => {
    const pending = snapshot('pending')
    const running = snapshot('running')
    const completed = snapshot('completed')
    const api = {
      openSnapshot: vi.fn()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(completed),
      runOperationNode: vi.fn(async () => running),
      cancelTask: vi.fn(async () => snapshot('failed')),
    }
    const plan = acceptancePlan([casePlan('CASE_A')])
    const results = await runCanvasAcceptancePlan({
      api,
      projectId: 'project-1',
      boardId: 'board-1',
      plan,
      caseNodeIds: { CASE_A: 'node-1' },
      pollIntervalMs: 1,
    })
    expect(api.runOperationNode).toHaveBeenCalledWith(
      'project-1',
      'node-1',
      expect.objectContaining({
        prompt: 'prompt',
        providerProfileId: 'provider-1',
        modelId: 'model-1',
      }),
    )
    expect(results).toEqual([{ caseId: 'CASE_A', status: 'passed', taskId: 'task-1' }])
  })

  it('blocks downstream cases when an upstream case is blocked', async () => {
    const blocked = { ...casePlan('CASE_A'), blockedReasons: ['missing_model_id'] }
    const downstream = casePlan('CASE_B', ['CASE_A'])
    const api = {
      openSnapshot: vi.fn(),
      runOperationNode: vi.fn(),
      cancelTask: vi.fn(),
    }
    const results = await runCanvasAcceptancePlan({
      api,
      projectId: 'project-1',
      boardId: 'board-1',
      plan: acceptancePlan([blocked, downstream], 'run-blocked'),
      caseNodeIds: { CASE_A: 'node-1', CASE_B: 'node-2' },
      pollIntervalMs: 1,
    })
    expect(results).toEqual([
      { caseId: 'CASE_A', status: 'blocked', error: 'missing_model_id' },
      { caseId: 'CASE_B', status: 'blocked', error: 'blocked_by_upstream:CASE_A' },
    ])
    expect(api.runOperationNode).not.toHaveBeenCalled()
  })

  it('creates a new task when rerunning a failed or assertion-failed case', async () => {
    const completed = snapshot('completed')
    const retried = snapshot('running')
    const terminal = snapshot('completed')
    const retriedNode = retried.nodes[0]
    const retriedTask = retried.tasks[0]
    const terminalNode = terminal.nodes[0]
    const terminalTask = terminal.tasks[0]
    if (!retriedNode || !retriedTask || !terminalNode || !terminalTask) {
      throw new Error('invalid test fixture')
    }
    retriedNode.taskId = 'task-2'
    retriedTask.id = 'task-2'
    terminalNode.taskId = 'task-2'
    terminalTask.id = 'task-2'
    const api = {
      openSnapshot: vi.fn().mockResolvedValueOnce(completed).mockResolvedValueOnce(terminal),
      runOperationNode: vi.fn(),
      retryOperationNode: vi.fn(async () => retried),
      cancelTask: vi.fn(async () => snapshot('failed')),
    }
    const results = await runCanvasAcceptancePlan({
      api,
      projectId: 'project-1',
      boardId: 'board-1',
      plan: acceptancePlan([casePlan('CASE_A')], 'run-retry'),
      caseNodeIds: { CASE_A: 'node-1' },
      caseIds: ['CASE_A'],
      retryExisting: true,
      pollIntervalMs: 1,
    })
    expect(api.retryOperationNode).toHaveBeenCalledWith('project-1', 'node-1', {
      sourceTaskId: 'task-1',
      runtimeSource: 'current-node',
    })
    expect(api.runOperationNode).not.toHaveBeenCalled()
    expect(results).toEqual([{ caseId: 'CASE_A', status: 'passed', taskId: 'task-2' }])
  })

  it('blocks a real call when the node target drifted from the frozen plan', async () => {
    const before = snapshot('pending')
    const node = before.nodes[0]
    if (!node) throw new Error('invalid test fixture')
    node.data.modelId = 'model-2'
    const api = {
      openSnapshot: vi.fn(async () => before),
      runOperationNode: vi.fn(),
      cancelTask: vi.fn(),
    }
    const results = await runCanvasAcceptancePlan({
      api,
      projectId: 'project-1',
      boardId: 'board-1',
      plan: acceptancePlan([casePlan('CASE_A')], 'run-drift'),
      caseNodeIds: { CASE_A: 'node-1' },
      pollIntervalMs: 1,
    })
    expect(results).toEqual([
      {
        caseId: 'CASE_A',
        status: 'blocked',
        error: 'preflight_config_drift:modelId',
      },
    ])
    expect(api.runOperationNode).not.toHaveBeenCalled()
  })

  it('does not skip a completed task whose current canvas assertions fail', async () => {
    const completed = snapshot('completed')
    const completedTask = completed.tasks[0]
    if (!completedTask) throw new Error('invalid test fixture')
    completedTask.modelOutputText = null
    const api = {
      openSnapshot: vi.fn(async () => completed),
      runOperationNode: vi.fn(),
      cancelTask: vi.fn(),
    }
    const results = await runCanvasAcceptancePlan({
      api,
      projectId: 'project-1',
      boardId: 'board-1',
      plan: acceptancePlan([casePlan('CASE_A')], 'run-existing-invalid'),
      caseNodeIds: { CASE_A: 'node-1' },
      pollIntervalMs: 1,
    })
    expect(results[0]).toMatchObject({
      caseId: 'CASE_A',
      status: 'failed',
      error: expect.stringContaining('text.model_output'),
    })
    expect(api.runOperationNode).not.toHaveBeenCalled()
  })

  it('cancels the real task when the acceptance wait timeout is reached', async () => {
    const pending = snapshot('pending')
    const running = snapshot('running')
    const cancelled = snapshot('failed')
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10 * 60 * 1_000)
    const api = {
      openSnapshot: vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(running),
      runOperationNode: vi.fn(async () => running),
      cancelTask: vi.fn(async () => cancelled),
    }
    try {
      const results = await runCanvasAcceptancePlan({
        api,
        projectId: 'project-1',
        boardId: 'board-1',
        plan: acceptancePlan([casePlan('CASE_A')], 'run-timeout'),
        caseNodeIds: { CASE_A: 'node-1' },
        pollIntervalMs: 1,
      })
      expect(api.cancelTask).toHaveBeenCalledWith('project-1', 'task-1')
      expect(results[0]).toMatchObject({
        caseId: 'CASE_A',
        status: 'failed',
        error: expect.stringContaining('等待任务终态超过'),
      })
    } finally {
      now.mockRestore()
    }
  })

  it('fails input resolution when a completed upstream operation has no materialized output', () => {
    const current = snapshot('pending')
    const baseNode = current.nodes[0]
    const baseTask = current.tasks[0]
    if (!baseNode || !baseTask) throw new Error('invalid test fixture')
    current.nodes.push({
      ...baseNode,
      id: 'upstream-node',
      taskId: 'upstream-task',
      data: { operation: 'text_generate' },
    })
    current.tasks.push({
      ...baseTask,
      id: 'upstream-task',
      operation: 'text_generate',
      operationNodeId: 'upstream-node',
      status: 'completed',
      outputNodeIds: [],
      outputAssetIds: [],
    })
    current.edges.push({
      id: 'edge-1', projectId: 'project-1', boardId: 'board-1', userId: 0,
      sourceNodeId: 'upstream-node', targetNodeId: 'node-1', type: 'used_as_input',
      createdAt: '', metadata: {},
    })
    expect(() => resolveAcceptanceRuntimeInputNodeIds(current, 'node-1')).toThrow(
      'upstream_materialized_output_missing:upstream-node',
    )
  })
})
