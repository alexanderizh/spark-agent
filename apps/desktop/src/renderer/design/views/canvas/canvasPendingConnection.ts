export type PendingCanvasConnection = {
  sourceNodeId: string
}

export type PendingConnectionNode = {
  id: string
}

export function buildPendingConnectionInput(
  pending: PendingCanvasConnection | null,
  node: PendingConnectionNode | null | undefined,
): { sourceNodeId: string; targetNodeId: string } | null {
  if (!pending || !node?.id || pending.sourceNodeId === node.id) return null
  return {
    sourceNodeId: pending.sourceNodeId,
    targetNodeId: node.id,
  }
}
