import type {
  CanvasMediaTaskInputFile,
  CanvasPromptTaskFields,
  SessionReasoningEffort,
} from '@spark/protocol'
import { isOperationNode, nodeOperation } from './canvas.capabilities'
import { migrateLegacyPrompt } from './canvasPromptDocument'
import { buildCanvasPromptSubmission } from './canvasPromptSubmission'
import {
  validateCanvasMediaTaskSubmission,
  validateCanvasTextTaskSubmission,
} from './canvasTaskSubmissionValidation'
import { fallbackPromptForOperation } from './canvasWorkspaceTaskInput'
import type {
  CanvasNode,
  CanvasOperationType,
  CanvasSnapshot,
} from './canvas.types'

export type SavedCanvasOperationRunParams = {
  prompt: string
  negativePrompt?: string
  inputNodeIds?: string[]
  inputAssetIds?: string[]
  inputFiles?: CanvasMediaTaskInputFile[]
  agentId?: string
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  reasoningEffort?: SessionReasoningEffort
  modelParams?: Record<string, unknown>
  skillIds?: string[]
  userPrompt?: string
  /** Skip the renderer-side provider parameter preflight after the user opted out. */
  skipParameterValidation?: boolean
} & CanvasPromptTaskFields

type SubmissionValidationRequest = SavedCanvasOperationRunParams & {
  operation: CanvasOperationType
}

export type PreparedCanvasOperationSubmission = {
  nodeId: string
  operation: CanvasOperationType
  title: string
  params: SavedCanvasOperationRunParams
}

export type CanvasOperationSubmissionDependencies = {
  compile: typeof buildCanvasPromptSubmission
  validateMedia: typeof validateCanvasMediaTaskSubmission
  validateText: typeof validateCanvasTextTaskSubmission
}

const DEFAULT_DEPENDENCIES: CanvasOperationSubmissionDependencies = {
  compile: buildCanvasPromptSubmission,
  validateMedia: validateCanvasMediaTaskSubmission,
  validateText: validateCanvasTextTaskSubmission,
}

export async function prepareSavedCanvasOperationSubmission(
  input: {
    snapshot: CanvasSnapshot
    node: CanvasNode
  },
  dependencies: CanvasOperationSubmissionDependencies = DEFAULT_DEPENDENCIES,
  options?: { skipParameterValidation?: boolean },
): Promise<PreparedCanvasOperationSubmission> {
  const { node, snapshot } = input
  if (!isOperationNode(node)) throw new Error('所选节点不是任务节点')
  if (node.data.status === 'running') throw new Error('任务正在运行')
  const operation = nodeOperation(node)
  if (!operation) throw new Error('任务节点缺少操作类型')
  const workflow = node.data.modelParams?.workflow
  if (workflow === 'extract_character' || workflow === 'extract_scene') {
    throw new Error('该流水线任务需单独运行')
  }

  const task = node.taskId
    ? snapshot.tasks.find((item) => item.id === node.taskId) ?? null
    : null
  const inputNodeIds = snapshot.edges
    .filter(
      (edge) =>
        edge.projectId === node.projectId &&
        edge.targetNodeId === node.id &&
        edge.type === 'used_as_input',
    )
    .map((edge) => edge.sourceNodeId)
  const inputNodeById = new Map(snapshot.nodes.map((item) => [item.id, item]))
  const inputAssetIds = inputNodeIds.flatMap((nodeId) => {
    const assetId = inputNodeById.get(nodeId)?.assetId
    return assetId ? [assetId] : []
  })
  const userPrompt = (node.data.prompt ?? task?.prompt ?? '').trim()
  const promptDocument =
    node.data.promptDocument ??
    task?.promptDocument ??
    migrateLegacyPrompt({
      prompt: userPrompt,
      nodes: snapshot.nodes,
      assets: snapshot.assets,
    })
  const negativePrompt = (node.data.negativePrompt ?? task?.negativePrompt ?? '').trim()
  const systemPrompt = (node.data.systemPrompt ?? task?.systemPrompt ?? '').trim()
  const inputBindings = node.data.inputBindings ?? task?.inputBindings
  const compiled = await dependencies.compile({
    document: promptDocument,
    snapshot,
    operation,
    inputNodeIds,
    ...(inputBindings ? { inputBindings } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
  })
  const inputFiles = compiled.inputFiles ?? []
  const prompt =
    compiled.prompt.trim() ||
    (inputFiles.length > 0 ? fallbackPromptForOperation(operation) : userPrompt)
  const nodeModelParams = node.data.modelParams
  const modelParams =
    nodeModelParams && Object.keys(nodeModelParams).length > 0
      ? nodeModelParams
      : (task?.modelParams ?? {})
  const agentId = node.data.agentId ?? task?.agentId ?? undefined
  const providerProfileId =
    node.data.providerProfileId ?? task?.providerProfileId ?? undefined
  const manifestId = node.data.manifestId ?? task?.manifestId ?? undefined
  const modelId = node.data.modelId ?? task?.modelId ?? undefined
  const reasoningEffort =
    node.data.reasoningEffort ?? task?.reasoningEffort ?? undefined
  const skillIds = node.data.skillIds ?? task?.skillIds ?? undefined

  const request: SubmissionValidationRequest = {
    operation,
    ...compiled,
    prompt,
    promptDocument,
    inputNodeIds,
    ...(inputAssetIds.length > 0 ? { inputAssetIds } : {}),
    ...(inputFiles.length > 0 ? { inputFiles } : {}),
    ...(negativePrompt ? { negativePrompt } : {}),
    ...(agentId ? { agentId } : {}),
    ...(providerProfileId ? { providerProfileId } : {}),
    ...(manifestId ? { manifestId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(skillIds ? { skillIds: [...skillIds] } : {}),
    ...(Object.keys(modelParams).length > 0 ? { modelParams: { ...modelParams } } : {}),
    userPrompt,
  }
  const validated = options?.skipParameterValidation
    ? request
    : isTextOperation(operation)
      ? dependencies.validateText(request)
      : await dependencies.validateMedia(request)
  const params = omitOperation({
    ...request,
    ...validated,
    prompt: validated.prompt ?? request.prompt,
  })
  if (options?.skipParameterValidation) params.skipParameterValidation = true

  return {
    nodeId: node.id,
    operation,
    title: node.title?.trim() || node.id,
    params,
  }
}

function isTextOperation(operation: CanvasOperationType): boolean {
  return (
    operation === 'text_generate' ||
    operation === 'text_rewrite' ||
    operation === 'prompt_optimize'
  )
}

function omitOperation(request: SubmissionValidationRequest): SavedCanvasOperationRunParams {
  const { operation: _operation, ...params } = request
  return params
}
