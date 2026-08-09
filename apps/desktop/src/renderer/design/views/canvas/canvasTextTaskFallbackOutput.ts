import type { CanvasTextTaskCreateResponse } from '@spark/protocol'
import type { CanvasAsset, CanvasEdge, CanvasNode, CanvasTask } from './canvas.types'
import { placeAutoNodeToRight } from './canvasAutoPlacement'
import { resolveCollisionFreeNodePosition } from './canvasCollisionPlacement'
import { pickTextNodeSize } from './canvasNodeSize'

type CanvasTextTaskOutputStore = {
  nodes: CanvasNode[]
  assets: CanvasAsset[]
  edges: CanvasEdge[]
}

type CanvasTextNodeFactoryInput = {
  nodes: readonly CanvasNode[]
  projectId: string
  boardId: string
  type: 'text'
  title?: string | null
  assetId?: string | null
  taskId?: string | null
  x: number
  y: number
  width: number
  height: number
  data: CanvasNode['data']
  at: string
}

/**
 * 语义校验失败时仍保留模型原文为普通文本产物。
 * 失败只表示「没有获得专用语义角色」，不应把已经返回的内容从画布上抹掉。
 */
export function materializeCanvasTextTaskFallbackOutput(input: {
  db: CanvasTextTaskOutputStore
  projectId: string
  userId: number
  task: CanvasTask
  taskNode: CanvasNode
  response: CanvasTextTaskCreateResponse
  text: string
  errorCode: string
  errorMessage: string
  at: string
  uid: (prefix: string) => string
  createNode: (input: CanvasTextNodeFactoryInput) => CanvasNode
}): CanvasNode {
  const outputText = input.text.trim()
  const configuredTitle =
    typeof input.taskNode.data.outputTitle === 'string'
      ? input.taskNode.data.outputTitle.trim()
      : ''
  const baseTitle = configuredTitle || input.task.title?.trim() || '文本结果'
  const size = pickTextNodeSize(outputText)
  const preferredPlacement = placeAutoNodeToRight(
    {
      x: input.taskNode.x,
      y: input.taskNode.y,
      width: input.taskNode.width,
      height: input.taskNode.height,
    },
    size,
  )
  const placement = resolveCollisionFreeNodePosition({
    preferred: preferredPlacement,
    size,
    nodes: input.db.nodes,
    boardId: input.task.boardId,
    preservePreferredPosition: true,
  })
  const asset: CanvasAsset = {
    id: input.uid('canvas_asset'),
    projectId: input.projectId,
    userId: input.userId,
    type: 'text',
    source: 'ai_generated',
    title: `${baseTitle}（原始结果）`,
    contentText: outputText,
    metadata: {
      taskId: input.task.id,
      providerProfileId: input.response.providerProfileId,
      provider: input.response.provider,
      model: input.response.model,
      validationCode: input.errorCode,
      validationMessage: input.errorMessage,
    },
    createdAt: input.at,
    updatedAt: input.at,
  }
  const resultNode = input.createNode({
    nodes: input.db.nodes,
    projectId: input.projectId,
    boardId: input.task.boardId,
    type: 'text',
    title: asset.title ?? null,
    assetId: asset.id,
    taskId: input.task.id,
    x: placement.x,
    y: placement.y,
    width: size.width,
    height: size.height,
    data: {
      text: outputText,
      format: 'markdown',
      origin: 'task_output',
    },
    at: input.at,
  })

  input.db.assets.push(asset)
  input.db.nodes.push(resultNode)
  input.db.edges.push({
    id: input.uid('canvas_edge'),
    projectId: input.projectId,
    boardId: input.task.boardId,
    userId: input.userId,
    sourceNodeId: input.taskNode.id,
    targetNodeId: resultNode.id,
    type: 'generated',
    taskId: input.task.id,
    metadata: { validationCode: input.errorCode },
    createdAt: input.at,
  })
  input.task.outputAssetIds.push(asset.id)
  input.task.outputNodeIds.push(resultNode.id)
  return resultNode
}
