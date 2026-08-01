import { useCallback, useEffect, useState } from 'react'
import type { CanvasNode } from './canvas.types'

export type CanvasMediaInputQuickKind = 'image' | 'video' | 'audio'

export function useCanvasMediaInputQuickActions(input: {
  nodes: readonly CanvasNode[]
  acceptedKinds: readonly CanvasMediaInputQuickKind[]
  onRequestCanvasNodePick?: ((onPick: (node: CanvasNode) => void) => void) | undefined
  onUploadLocalFile?: ((file: File) => Promise<CanvasNode | null | undefined>) | undefined
  onAppendNode: (node: CanvasNode) => void
  onInvalidNode?: ((node: CanvasNode) => void) | undefined
}) {
  const [pendingUploadedNode, setPendingUploadedNode] = useState<CanvasNode | null>(null)
  const acceptsNode = useCallback(
    (node: CanvasNode) => input.acceptedKinds.includes(node.type as CanvasMediaInputQuickKind),
    [input.acceptedKinds],
  )
  const commitNode = useCallback(
    (node: CanvasNode) => {
      if (!acceptsNode(node)) {
        input.onInvalidNode?.(node)
        return false
      }
      input.onAppendNode(node)
      return true
    },
    [acceptsNode, input],
  )

  useEffect(() => {
    if (!pendingUploadedNode) return
    const resolved = input.nodes.find((node) => node.id === pendingUploadedNode.id)
    if (!resolved) return
    commitNode(resolved)
    setPendingUploadedNode(null)
  }, [commitNode, input.nodes, pendingUploadedNode])

  const pick = useCallback(() => {
    input.onRequestCanvasNodePick?.((node) => {
      commitNode(node)
    })
  }, [commitNode, input.onRequestCanvasNodePick])

  const upload = useCallback(
    async (file: File) => {
      const uploaded = await input.onUploadLocalFile?.(file)
      if (!uploaded || !acceptsNode(uploaded)) {
        if (uploaded) input.onInvalidNode?.(uploaded)
        return
      }
      const resolved = input.nodes.find((node) => node.id === uploaded.id)
      if (resolved) commitNode(resolved)
      else setPendingUploadedNode(uploaded)
    },
    [acceptsNode, commitNode, input],
  )

  return { pick, upload }
}
