export function resolveCanvasPaneContextMenuBoundary(
  stageElement: HTMLElement | null,
  triggerElement: HTMLElement | null,
): HTMLElement | null {
  return stageElement ?? triggerElement?.closest<HTMLElement>('.canvas-stage') ?? null
}
