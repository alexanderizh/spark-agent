import { describe, expect, it, vi } from 'vitest'
import type {
  CanvasWorkflowExecutionPlan,
  CanvasWorkflowRun,
  CanvasWorkflowRunStep,
} from '@spark/protocol'
import { executeCanvasWorkflowPlan } from './canvasWorkflowRunner'

function step(
  nodeId: string,
  stepIndex: number,
  status: CanvasWorkflowRunStep['status'],
): CanvasWorkflowRunStep {
  return {
    id: `step-${nodeId}`,
    runId: 'run-1',
    nodeId,
    stepIndex,
    status,
    dependsOnNodeIds: stepIndex === 0 ? [] : ['input'],
    taskId: null,
    input: {},
    output: null,
    error: null,
    attempt: 1,
    startedAt: null,
    finishedAt: null,
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

function run(steps: CanvasWorkflowRunStep[]): CanvasWorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'workflow-1',
    workflowVersion: 1,
    projectId: 'project-1',
    status: 'queued',
    inputs: { theme: '日落' },
    exposedParams: {},
    outputs: {},
    error: null,
    idempotencyKey: 'request-1',
    createdAt: '2026-07-23T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    updatedAt: '2026-07-23T00:00:00.000Z',
    steps,
  }
}

const plan: CanvasWorkflowExecutionPlan = {
  schemaVersion: 1,
  nodeOrder: ['input', 'generate'],
  steps: [
    {
      nodeId: 'input',
      kind: 'canvas_input',
      label: '输入',
      config: {},
      dependsOnNodeIds: [],
      incomingEdges: [],
      outgoingEdges: [],
    },
    {
      nodeId: 'generate',
      kind: 'canvas_operation',
      label: '生成',
      config: { operation: 'text_to_image' },
      dependsOnNodeIds: ['input'],
      incomingEdges: [],
      outgoingEdges: [],
    },
  ],
  contract: { inputs: [], outputs: [], exposedParams: [] },
  dependencies: { modelCapabilities: [], canvasNodeKinds: [] },
}

describe('executeCanvasWorkflowPlan', () => {
  it('executes ready steps in plan order and skips completed work when resuming', async () => {
    let current = run([step('input', 0, 'completed'), step('generate', 1, 'ready')])
    const updateStep = vi.fn(async (input: any) => {
      current = {
        ...current,
        status: input.status === 'completed' ? 'completed' : 'running',
        steps: current.steps.map((item) =>
          item.nodeId === input.nodeId
            ? { ...item, status: input.status, output: input.output ?? item.output }
            : item,
        ),
      }
      return current
    })
    const executeStep = vi.fn(async () => ({ taskId: 'task-1', output: { assetId: 'asset-1' } }))

    const result = await executeCanvasWorkflowPlan({
      run: current,
      plan,
      updateStep,
      executeStep,
      cancelRun: vi.fn(),
    })

    expect(executeStep).toHaveBeenCalledTimes(1)
    expect(executeStep).toHaveBeenCalledWith(
      expect.objectContaining({ step: expect.objectContaining({ nodeId: 'generate' }) }),
    )
    expect(updateStep.mock.calls.map(([input]) => input.status)).toEqual(['running', 'completed'])
    expect(result.status).toBe('completed')
  })

  it('persists a failed step and stops downstream execution', async () => {
    let current = run([step('input', 0, 'ready'), step('generate', 1, 'blocked')])
    const updateStep = vi.fn(async (input: any) => {
      current = {
        ...current,
        status: input.status === 'failed' ? 'failed' : 'running',
        steps: current.steps.map((item) =>
          item.nodeId === input.nodeId ? { ...item, status: input.status } : item,
        ),
      }
      return current
    })

    await expect(
      executeCanvasWorkflowPlan({
        run: current,
        plan,
        updateStep,
        executeStep: async () => {
          throw new Error('provider failed')
        },
        cancelRun: vi.fn(),
      }),
    ).rejects.toThrow(/provider failed/)
    expect(updateStep).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed', error: expect.objectContaining({ message: 'provider failed' }) }),
    )
  })

  it('cancels the persisted run when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const cancelRun = vi.fn(async () => ({ ...run([]), status: 'cancelled' as const }))

    const result = await executeCanvasWorkflowPlan({
      run: run([step('input', 0, 'ready')]),
      plan,
      updateStep: vi.fn(),
      executeStep: vi.fn(),
      cancelRun,
      signal: controller.signal,
    })

    expect(cancelRun).toHaveBeenCalledWith('run-1')
    expect(result.status).toBe('cancelled')
  })
})
