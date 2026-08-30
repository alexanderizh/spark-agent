import type { CanvasEdge } from './canvas.types'

type CanvasScaleCompressDerivationInput = {
  id: string
  userId: number
  projectId: string
  boardId: string
  sourceNodeId: string
  targetNodeId: string
  mediaKind: 'image' | 'video'
  scalePercent: number
  compressPercent: number
  createdAt: string
}

/**
 * 用户主动执行尺寸压缩得到的是源节点的派生副本，不是任务的原始生成产物。
 * 使用 derived_from 可让副本保持独立可见，同时保留来源关系。
 */
export function createCanvasScaleCompressDerivationEdge(
  input: CanvasScaleCompressDerivationInput,
): CanvasEdge {
  const operationMetadata =
    input.mediaKind === 'video' ? { videoOp: 'scale-compress' } : { imageOp: 'scale-compress' }

  return {
    id: input.id,
    userId: input.userId,
    projectId: input.projectId,
    boardId: input.boardId,
    sourceNodeId: input.sourceNodeId,
    targetNodeId: input.targetNodeId,
    type: 'derived_from',
    taskId: null,
    metadata: {
      ...operationMetadata,
      scalePercent: input.scalePercent,
      compressPercent: input.compressPercent,
    },
    createdAt: input.createdAt,
  }
}
