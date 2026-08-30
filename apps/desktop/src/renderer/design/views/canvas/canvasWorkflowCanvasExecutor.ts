import type { CanvasWorkflowPackage } from '@spark/protocol'
import type {
  CanvasWorkflowStepExecutionContext,
  CanvasWorkflowStepExecutionResult,
} from './canvasWorkflowRunner'

export interface CanvasWorkflowOperationRequest {
  operation: string
  prompt: string
  negativePrompt?: string
  inputNodeIds: string[]
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  modelParams: Record<string, unknown>
  agentId?: string
  skillIds?: string[]
  taskTitle: string
  outputTitle?: string
}

export interface CanvasWorkflowCreatedTask {
  id: string
}

export interface CanvasWorkflowCompletedTask {
  id: string
  outputNodeIds: string[]
  outputAssetIds: string[]
}

export interface CanvasWorkflowSubworkflowRequest {
  workflowId: string
  workflowVersion: number
  inputs: Record<string, unknown>
  exposedParams: Record<string, unknown>
  idempotencyKey: string
  signal?: AbortSignal
}

export interface CanvasWorkflowSubworkflowResult {
  runId: string
  workflowVersion: number
  outputs: Record<string, unknown>
}

export interface CanvasWorkflowCanvasExecutorDependencies {
  contract: CanvasWorkflowPackage['contract']
  createOperation: (
    request: CanvasWorkflowOperationRequest,
  ) => Promise<CanvasWorkflowCreatedTask | null>
  waitForTask: (
    taskId: string,
    signal?: AbortSignal,
  ) => Promise<CanvasWorkflowCompletedTask>
  markProvenance: (
    task: CanvasWorkflowCompletedTask,
    context: CanvasWorkflowStepExecutionContext,
  ) => Promise<void>
  executeSubworkflow?: (
    request: CanvasWorkflowSubworkflowRequest,
  ) => Promise<CanvasWorkflowSubworkflowResult>
}

function cloneRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return structuredClone(value)
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return
  let cursor = target
  for (const part of parts.slice(0, -1)) {
    const existing = cursor[part]
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) cursor[part] = {}
    cursor = cursor[part] as Record<string, unknown>
  }
  cursor[parts.at(-1)!] = value
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

function upstreamNodeIds(outputs: ReadonlyMap<string, Record<string, unknown>>): string[] {
  const ids: string[] = []
  for (const output of outputs.values()) {
    const outputNodeIds = output.outputNodeIds
    if (Array.isArray(outputNodeIds)) {
      for (const nodeId of outputNodeIds) if (typeof nodeId === 'string') ids.push(nodeId)
    }
  }
  return [...new Set(ids)]
}

function upstreamText(outputs: ReadonlyMap<string, Record<string, unknown>>): string[] {
  const values: string[] = []
  for (const output of outputs.values()) {
    const value = stringValue(output.value) ?? stringValue(output.text)
    if (value) values.push(value)
  }
  return values
}

function directInputText(
  context: CanvasWorkflowStepExecutionContext,
  contract: CanvasWorkflowPackage['contract'],
): string[] {
  return contract.inputs
    .filter((input) => input.targetNodeId === context.step.nodeId && input.valueType === 'text')
    .map((input) => stringValue(context.run.inputs[input.id]))
    .filter((value): value is string => value != null)
}

function nodeIdsFromInputValue(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const nodeId = (value as Record<string, unknown>).nodeId
    if (typeof nodeId === 'string' && nodeId.trim()) return [nodeId.trim()]
  }
  return []
}

function directInputNodeIds(
  context: CanvasWorkflowStepExecutionContext,
  contract: CanvasWorkflowPackage['contract'],
): string[] {
  return contract.inputs
    .filter(
      (input) =>
        input.targetNodeId === context.step.nodeId &&
        ['image', 'video', 'audio', 'file', 'asset', 'node'].includes(input.valueType),
    )
    .map((input) => context.run.inputs[input.id])
    .flatMap(nodeIdsFromInputValue)
}

function optionalString(config: Record<string, unknown>, key: string): string | undefined {
  const value = config[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function optionalStringList(config: Record<string, unknown>, key: string): string[] | undefined {
  const value = config[key]
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item): item is string => typeof item === 'string' && Boolean(item))
  return strings.length > 0 ? strings : undefined
}

function optionalRecord(config: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = config[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? cloneRecord(value as Record<string, unknown>)
    : {}
}

function readPath(value: unknown, path: string | undefined): unknown {
  if (!path) return value
  let cursor = value
  for (const part of path.split('.').filter(Boolean)) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function subworkflowInputs(
  context: CanvasWorkflowStepExecutionContext,
  contract: CanvasWorkflowPackage['contract'],
  config: Record<string, unknown>,
): Record<string, unknown> {
  const inputs = optionalRecord(config, 'inputs')
  for (const input of contract.inputs) {
    if (input.targetNodeId !== context.step.nodeId) continue
    const value = context.run.inputs[input.id]
    if (value !== undefined) inputs[input.targetHandle ?? input.id] = value
  }
  for (const edge of context.step.incomingEdges) {
    if (!edge.targetHandle) continue
    const upstream = context.outputsByNodeId.get(edge.sourceNodeId)
    if (!upstream) continue
    const value = readPath(upstream, edge.sourceHandle)
    if (value !== undefined) inputs[edge.targetHandle] = value
  }
  return inputs
}

export async function executeCanvasWorkflowCanvasStep(
  context: CanvasWorkflowStepExecutionContext,
  dependencies: CanvasWorkflowCanvasExecutorDependencies,
): Promise<CanvasWorkflowStepExecutionResult> {
  const { step, run } = context
  if (step.kind === 'canvas_input') {
    const inputs = dependencies.contract.inputs.filter(
      (input) => input.targetNodeId === step.nodeId || (!input.targetNodeId && input.id === step.nodeId),
    )
    if (inputs.length === 1) {
      const input = inputs[0]!
      const value = run.inputs[input.id]
      const nodeIds = ['image', 'video', 'audio', 'file', 'asset', 'node'].includes(
        input.valueType,
      )
        ? nodeIdsFromInputValue(value)
        : []
      return {
        output: {
          value,
          inputId: input.id,
          ...(nodeIds.length > 0 ? { outputNodeIds: nodeIds } : {}),
        },
      }
    }
    return {
      output: {
        values: Object.fromEntries(inputs.map((input) => [input.id, run.inputs[input.id]])),
      },
    }
  }

  if (step.kind === 'canvas_param') {
    return { output: { values: run.exposedParams } }
  }

  const config = cloneRecord(step.config)
  for (const param of dependencies.contract.exposedParams) {
    if (param.nodeId === step.nodeId && Object.hasOwn(run.exposedParams, param.id)) {
      setPath(config, param.path, run.exposedParams[param.id])
    }
  }

  if (step.kind === 'canvas_asset_ref') {
    return { output: config }
  }

  if (step.kind === 'canvas_output') {
    const first = step.dependsOnNodeIds
      .map((nodeId) => context.outputsByNodeId.get(nodeId))
      .find((output) => output != null)
    return { output: first ? cloneRecord(first) : {} }
  }

  if (step.kind === 'canvas_transform') {
    return {
      output: {
        ...config,
        upstream: Object.fromEntries(context.outputsByNodeId),
      },
    }
  }

  if (step.kind === 'canvas_subworkflow') {
    const workflowId = optionalString(config, 'workflowId')
    if (!workflowId) throw new Error(`子工作流节点“${step.label}”缺少 workflowId`)
    const workflowVersion = config.workflowVersion
    if (
      typeof workflowVersion !== 'number' ||
      !Number.isInteger(workflowVersion) ||
      workflowVersion <= 0
    ) {
      throw new Error(`子工作流节点“${step.label}”缺少有效的 workflowVersion`)
    }
    if (!dependencies.executeSubworkflow) {
      throw new Error(`子工作流节点“${step.label}”缺少运行器`)
    }
    const child = await dependencies.executeSubworkflow({
      workflowId,
      workflowVersion,
      inputs: subworkflowInputs(context, dependencies.contract, config),
      exposedParams: optionalRecord(config, 'exposedParams'),
      idempotencyKey: `${run.id}:${step.nodeId}:${context.runtimeStep.attempt}`,
      ...(context.signal ? { signal: context.signal } : {}),
    })
    return {
      output: {
        childRunId: child.runId,
        childWorkflowId: workflowId,
        childWorkflowVersion: child.workflowVersion,
        outputs: child.outputs,
      },
    }
  }

  const operation = optionalString(config, 'operation')
  if (!operation) throw new Error(`操作节点“${step.label}”缺少 operation`)
  const explicitPrompt = optionalString(config, 'prompt')
  const prompt = [
    explicitPrompt,
    ...directInputText(context, dependencies.contract),
    ...upstreamText(context.outputsByNodeId),
  ]
    .filter(Boolean)
    .join('\n\n')
  const negativePrompt = optionalString(config, 'negativePrompt')
  const providerProfileId = optionalString(config, 'providerProfileId')
  const manifestId = optionalString(config, 'manifestId')
  const modelId = optionalString(config, 'modelId')
  const agentId = optionalString(config, 'agentId')
  const skillIds = optionalStringList(config, 'skillIds')
  const outputTitle = optionalString(config, 'outputTitle')
  const created = await dependencies.createOperation({
    operation,
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    inputNodeIds: [
      ...new Set([
        ...directInputNodeIds(context, dependencies.contract),
        ...upstreamNodeIds(context.outputsByNodeId),
      ]),
    ],
    ...(providerProfileId ? { providerProfileId } : {}),
    ...(manifestId ? { manifestId } : {}),
    ...(modelId ? { modelId } : {}),
    modelParams:
      config.modelParams && typeof config.modelParams === 'object' && !Array.isArray(config.modelParams)
        ? (config.modelParams as Record<string, unknown>)
        : {},
    ...(agentId ? { agentId } : {}),
    ...(skillIds ? { skillIds } : {}),
    taskTitle: step.label,
    ...(outputTitle ? { outputTitle } : {}),
  })
  if (!created) throw new Error(`操作节点“${step.label}”未能创建画布任务`)
  const completed = await dependencies.waitForTask(created.id, context.signal)
  await dependencies.markProvenance(completed, context)
  return {
    taskId: completed.id,
    output: {
      taskId: completed.id,
      outputNodeIds: completed.outputNodeIds,
      outputAssetIds: completed.outputAssetIds,
    },
  }
}
