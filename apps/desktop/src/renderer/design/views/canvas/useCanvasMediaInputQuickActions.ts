import { useCallback } from 'react'
import type { CanvasNode } from './canvas.types'
import {
  type CanvasNodeMediaKind,
  resolveCanvasNodeMediaKind,
  resolveEffectiveMediaSourceNode,
} from './canvasNodeMediaKind'

export type CanvasMediaInputQuickKind = 'image' | 'video' | 'audio'

export function useCanvasMediaInputQuickActions(input: {
  nodes: readonly CanvasNode[]
  acceptedKinds: readonly CanvasMediaInputQuickKind[]
  /**
   * 任务节点（text_to_video / image_to_video 等）→ 其产物 output 媒体类型的映射。
   * 提供后，「从画布选择」可以选中带视频/图片/音频产物的任务节点，等价于选它的产物。
   * 由调用方用 buildOutputMediaKindMap(snapshot.nodes, snapshot.edges) 预构建。
   */
  outputMediaKindByNodeId?: ReadonlyMap<string, CanvasNodeMediaKind>
  /**
   * 任务节点 → 其产物 output 媒体节点的映射，用于提交时拿到真实产物节点的 url/asset。
   * 不提供时，任务节点即使通过校验也会按自身（无 url）提交；调用方应与 outputMediaKindByNodeId 一起提供。
   */
  outputMediaNodeByNodeId?: ReadonlyMap<string, CanvasNode>
  onRequestCanvasNodePick?: ((onPick: (node: CanvasNode) => void) => void) | undefined
  onAppendNode: (node: CanvasNode) => void
  onInvalidNode?: ((node: CanvasNode) => void) | undefined
}) {
  const acceptsNode = useCallback(
    (node: CanvasNode) => {
      const kind = resolveCanvasNodeMediaKind(node, input.outputMediaKindByNodeId)
      return kind != null && input.acceptedKinds.includes(kind)
    },
    [input.acceptedKinds, input.outputMediaKindByNodeId],
  )
  const commitNode = useCallback(
    (node: CanvasNode) => {
      if (!acceptsNode(node)) {
        input.onInvalidNode?.(node)
        return false
      }
      // 任务节点解析为它的产物 output 媒体节点；纯素材节点原样返回。
      const effective = resolveEffectiveMediaSourceNode(node, input.outputMediaNodeByNodeId)
      input.onAppendNode(effective)
      return true
    },
    [acceptsNode, input],
  )

  const pick = useCallback(() => {
    input.onRequestCanvasNodePick?.((node) => {
      commitNode(node)
    })
  }, [commitNode, input.onRequestCanvasNodePick])

  return { pick }
}
