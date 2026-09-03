// “新建任务”固定占据侧栏第一项，因此工作台菜单默认只再展示三项。
export const DEFAULT_VISIBLE_SIDEBAR_NAV_COUNT = 3

export function resolveSidebarNavVisibility<T extends { id: string }>(
  items: T[],
  pinnedIds: string[],
): { visibleItems: T[]; collapsedItems: T[] } {
  const pinnedIdSet = new Set(pinnedIds)
  const pinnedItems = items.filter((item) => pinnedIdSet.has(item.id))
  const unpinnedItems = items.filter((item) => !pinnedIdSet.has(item.id))
  const remainingVisibleSlots = Math.max(0, DEFAULT_VISIBLE_SIDEBAR_NAV_COUNT - pinnedItems.length)

  return {
    visibleItems: [...pinnedItems, ...unpinnedItems.slice(0, remainingVisibleSlots)],
    collapsedItems: unpinnedItems.slice(remainingVisibleSlots),
  }
}
