const CANVAS_NODE_SCROLL_REGION_SELECTOR = [
  '.canvas-node-text',
  '.canvas-node-task-msg',
  '.canvas-node-shot-table-wrap',
  '.canvas-node-inline-panel',
  '.canvas-node-resource-text-content',
  '.canvas-operation-output-json',
  '.canvas-operation-output-text',
  '.canvas-operation-output-list-items',
].join(', ')

/**
 * 只有已选中节点中实际可滚动的内容区才截留普通滚轮；其余位置交给画布平移。
 */
export function findSelectedCanvasNodeScrollRegion(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const nodeShell = target.closest<HTMLElement>('.canvas-node-shell')
  const selectedNode =
    target.closest<HTMLElement>('.canvas-node-selected') ??
    nodeShell?.querySelector<HTMLElement>(':scope > .canvas-node-selected')
  if (!selectedNode) return null

  const element = target.closest<HTMLElement>(CANVAS_NODE_SCROLL_REGION_SELECTOR)
  if (!element || (!selectedNode.contains(element) && !nodeShell?.contains(element))) return null

  const canScrollY = element.scrollHeight - element.clientHeight > 1
  const canScrollX = element.scrollWidth - element.clientWidth > 1
  return canScrollY || canScrollX ? element : null
}
