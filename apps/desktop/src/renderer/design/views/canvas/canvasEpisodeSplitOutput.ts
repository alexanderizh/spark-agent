import type { CanvasTextTaskCreateResponse } from '@spark/protocol'
import type {
  CanvasAsset,
  CanvasEdge,
  CanvasNode,
  CanvasPipelineRole,
  CanvasTask,
} from './canvas.types'
import { stackAutoNodesToRight } from './canvasAutoPlacement'
import { pickTextNodeSize } from './canvasNodeSize'
import {
  formatSplitEpisodeScreenplayText,
  splitEpisodeNodeTitle,
  type ParsedSplitEpisode,
} from './canvasEpisodeSplit'

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
 * 分集任务产物落画布：每集一个独立剧本节点（数组元素），纵向排在任务节点
 * 右侧，每集独立 asset + generated 边，并写入 task.outputNodeIds /
 * outputAssetIds。返回成功落库的集数；单集失败不影响其余集。
 */
export function materializeSplitEpisodeOutputs(input: {
  db: CanvasTextTaskOutputStore
  projectId: string
  userId: number
  task: CanvasTask
  taskNode: CanvasNode
  response: CanvasTextTaskCreateResponse
  episodes: readonly ParsedSplitEpisode[]
  pipelineRole: CanvasPipelineRole | undefined
  at: string
  uid: (prefix: string) => string
  createNode: (input: CanvasTextNodeFactoryInput) => CanvasNode
}): number {
  const items = input.episodes.map((episode) => {
    const text = formatSplitEpisodeScreenplayText(episode)
    return { episode, text, size: pickTextNodeSize(text) }
  })
  const placements = stackAutoNodesToRight(
    {
      x: input.taskNode.x,
      y: input.taskNode.y,
      width: input.taskNode.width,
      height: input.taskNode.height,
    },
    items.map((item) => item.size),
  )
  let created = 0
  for (const [index, item] of items.entries()) {
    const placement = placements[index]
    if (!placement) continue
    const title = splitEpisodeNodeTitle(item.episode)
    const asset: CanvasAsset = {
      id: input.uid('canvas_asset'),
      projectId: input.projectId,
      userId: input.userId,
      type: 'text',
      source: 'ai_generated',
      title,
      contentText: item.text,
      metadata: {
        taskId: input.task.id,
        episodeNo: item.episode.episodeNo,
        providerProfileId: input.response.providerProfileId,
        provider: input.response.provider,
        model: input.response.model,
      },
      createdAt: input.at,
      updatedAt: input.at,
    }
    const resultNode = input.createNode({
      nodes: input.db.nodes,
      projectId: input.projectId,
      boardId: input.task.boardId,
      type: 'text',
      title,
      assetId: asset.id,
      taskId: input.task.id,
      x: placement.x,
      y: placement.y,
      width: item.size.width,
      height: item.size.height,
      data: {
        text: item.text,
        format: 'markdown',
        origin: 'task_output',
        ...(input.pipelineRole ? { pipelineRole: input.pipelineRole } : {}),
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
      metadata: {},
      createdAt: input.at,
    })
    input.task.outputAssetIds.push(asset.id)
    input.task.outputNodeIds.push(resultNode.id)
    created += 1
  }
  return created
}
