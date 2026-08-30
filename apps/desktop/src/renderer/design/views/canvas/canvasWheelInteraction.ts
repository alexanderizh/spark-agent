const CANVAS_NODE_SCROLL_REGION_SELECTOR = [
  '.canvas-node-text',
  '.canvas-node-task-msg',
  '.canvas-node-shot-table-wrap',
  '.canvas-node-inline-panel',
  '.canvas-node-resource-text-content',
  '.canvas-operation-output-json',
  '.canvas-operation-output-text',
  '.canvas-operation-output-list-items',
  '.canvas-operation-history',
  '.canvas-operation-node-settings',
  '.canvas-operation-panel-body',
  '.canvas-bottom-floating-body',
  '.canvas-node-edit-bottom-body',
].join(', ')

const CANVAS_FLOATING_PANEL_SELECTOR = [
  '.canvas-node-bottom-editor',
  '.canvas-node-floating-panel',
  '.canvas-operation-panel',
  '.canvas-bottom-floating-panel',
].join(', ')

/**
 * 只有已选中节点或显式画布浮层中的实际可滚动内容区才截留普通滚轮；
 * 其余位置交给画布平移。
 */
export function findSelectedCanvasNodeScrollRegion(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null

  // 画布 portal 弹层（模型选择器等）渲染在 overlay host 内，不在节点树中，
  // 其内部标记了 data-canvas-overlay-scroll 的可滚动列表同样需要截留普通滚轮。
  // 否则 wheel 会被画布平移吃掉，列表底部内容滚不到、选不中。
  // 标记区域即使当前不可滚也直接放行（返回元素本身），由浏览器自然处理
  // （不可滚则静止），绝不回退到画布平移——避免在浮层上滚轮导致画布乱动。
  const overlayScrollRegion = target.closest<HTMLElement>('[data-canvas-overlay-scroll]')
  if (overlayScrollRegion) {
    return overlayScrollRegion
  }

  // 节点详情/产物工作台会被渲染到画布节点外的浮层中。它们没有
  // `.canvas-node-shell` 祖先，但仍必须优先截留滚轮，避免画布捕获浮层内容区的滚动。
  const floatingPanel = target.closest<HTMLElement>(CANVAS_FLOATING_PANEL_SELECTOR)
  const floatingScrollRegion = target.closest<HTMLElement>(CANVAS_NODE_SCROLL_REGION_SELECTOR)
  if (floatingPanel && floatingScrollRegion && floatingPanel.contains(floatingScrollRegion)) {
    const canScrollY = floatingScrollRegion.scrollHeight - floatingScrollRegion.clientHeight > 1
    const canScrollX = floatingScrollRegion.scrollWidth - floatingScrollRegion.clientWidth > 1
    return canScrollY || canScrollX ? floatingScrollRegion : null
  }

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
