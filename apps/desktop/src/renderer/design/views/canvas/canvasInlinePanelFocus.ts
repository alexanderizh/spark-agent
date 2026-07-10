export function shouldFocusCanvasInlinePanel({
  inlinePanelNodeId,
  requestedNodeId,
}: {
  inlinePanelNodeId: string | null
  requestedNodeId: string | null
}): boolean {
  return inlinePanelNodeId != null && requestedNodeId === inlinePanelNodeId
}
