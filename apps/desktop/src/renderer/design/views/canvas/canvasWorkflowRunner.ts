import type {
  CanvasWorkflowExecutionPlan,
  CanvasWorkflowExecutionStep,
  CanvasWorkflowRun,
  CanvasWorkflowRunStep,
  CanvasWorkflowRunStepUpdateRequest,
} from '@spark/protocol'

export interface CanvasWorkflowStepExecutionContext {
  run: CanvasWorkflowRun
  step: CanvasWorkflowExecutionStep
  runtimeStep: CanvasWorkflowRunStep
  outputsByNodeId: ReadonlyMap<string, Record<string, unknown>>
  signal?: AbortSignal
}

export interface CanvasWorkflowStepExecutionResult {
  taskId?: string
  output: Record<string, unknown>
}

export interface ExecuteCanvasWorkflowPlanOptions {
  run: CanvasWorkflowRun
  plan: CanvasWorkflowExecutionPlan
  updateStep: (request: CanvasWorkflowRunStepUpdateRequest) => Promise<CanvasWorkflowRun>
  executeStep: (
    context: CanvasWorkflowStepExecutionContext,
  ) => Promise<CanvasWorkflowStepExecutionResult>
  cancelRun: (runId: string) => Promise<CanvasWorkflowRun>
  signal?: AbortSignal
}

function errorPayload(error: unknown): Record<string, unknown> {
  return {
    code: 'canvas_workflow_step_failed',
    message: error instanceof Error ? error.message : String(error),
  }
}

export async function executeCanvasWorkflowPlan(
  options: ExecuteCanvasWorkflowPlanOptions,
): Promise<CanvasWorkflowRun> {
  let current = options.run
  const stepByNodeId = new Map(options.plan.steps.map((step) => [step.nodeId, step]))

  while (!['completed', 'failed', 'cancelled'].includes(current.status)) {
    if (options.signal?.aborted) return options.cancelRun(current.id)

    const runtimeStep = options.plan.nodeOrder
      .map((nodeId) => current.steps.find((item) => item.nodeId === nodeId))
      .find((item) => item?.status === 'ready')
    if (!runtimeStep) {
      if (current.steps.every((item) => item.status === 'completed' || item.status === 'skipped')) {
        return current
      }
      throw new Error('画布工作流没有可执行步骤，运行状态可能已过期')
    }

    const step = stepByNodeId.get(runtimeStep.nodeId)
    if (!step) throw new Error(`运行计划缺少节点：${runtimeStep.nodeId}`)

    current = await options.updateStep({
      runId: current.id,
      nodeId: step.nodeId,
      status: 'running',
    })

    const outputsByNodeId = new Map<string, Record<string, unknown>>()
    for (const item of current.steps) {
      if (item.output) outputsByNodeId.set(item.nodeId, item.output)
    }

    try {
      const result = await options.executeStep({
        run: current,
        step,
        runtimeStep,
        outputsByNodeId,
        ...(options.signal ? { signal: options.signal } : {}),
      })
      if (options.signal?.aborted) return options.cancelRun(current.id)
      current = await options.updateStep({
        runId: current.id,
        nodeId: step.nodeId,
        status: 'completed',
        ...(result.taskId ? { taskId: result.taskId } : {}),
        output: result.output,
      })
    } catch (error) {
      if (options.signal?.aborted) return options.cancelRun(current.id)
      await options.updateStep({
        runId: current.id,
        nodeId: step.nodeId,
        status: 'failed',
        error: errorPayload(error),
      })
      throw error
    }
  }

  return current
}
