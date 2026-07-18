export type CanvasSelectionEscapeInput = {
  key: string
  selectedNodeCount: number
  hasOpenContextMenu: boolean
  editableTarget: boolean
}

export function shouldClearCanvasSelectionOnEscape({
  key,
  selectedNodeCount,
  hasOpenContextMenu,
  editableTarget,
}: CanvasSelectionEscapeInput): boolean {
  return (
    key === 'Escape' &&
    selectedNodeCount > 0 &&
    !hasOpenContextMenu &&
    !editableTarget
  )
}
