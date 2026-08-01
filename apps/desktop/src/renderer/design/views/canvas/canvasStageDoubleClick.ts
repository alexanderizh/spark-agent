export function shouldDelegateNodeDoubleClickToCollapsedGroup(target: Element): boolean {
  return Boolean(target.closest('.canvas-node-collapsed-group'))
}
