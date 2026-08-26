/**
 * Applies a persisted manual order without mutating the source array.
 * Items created after the last manual reorder have no rank yet and stay at the
 * front in their existing fallback order (normally most-recent first).
 */
export function sortByManualOrder<T>(
  items: readonly T[],
  manualIds: readonly string[] | undefined,
  getId: (item: T) => string,
): T[] {
  if (manualIds == null || manualIds.length === 0) return [...items]
  const rank = new Map(manualIds.map((id, index) => [id, index] as const))
  return items
    .map((item, index) => ({ item, index, rank: rank.get(getId(item)) }))
    .sort((left, right) => {
      if (left.rank == null && right.rank != null) return -1
      if (left.rank != null && right.rank == null) return 1
      if (left.rank != null && right.rank != null) return left.rank - right.rank
      return left.index - right.index
    })
    .map(({ item }) => item)
}

/**
 * Applies one manual order while keeping pinned items in their own leading
 * section. The persisted project order is shared by both sections, so the
 * manual ranks must be applied before the stable pinned/unpinned partition.
 */
export function sortByManualOrderWithinPinnedSections<T>(
  items: readonly T[],
  manualIds: readonly string[] | undefined,
  getId: (item: T) => string,
  isPinned: (item: T) => boolean,
): T[] {
  const manuallyOrdered = sortByManualOrder(items, manualIds, getId)
  return [...manuallyOrdered.filter(isPinned), ...manuallyOrdered.filter((item) => !isPinned(item))]
}

/**
 * 拖拽发生在被筛选视图（部分项目/会话被筛选隐藏）上时，把仅含可见项的新顺序合并回
 * 完整手动序：可见项按 visibleNext 的相对顺序落位，被隐藏但仍存在的项按原有邻居
 * 位置插回，避免一次拖拽把隐藏项挤出手动序（丢秩项会浮到段首，等于排序被破坏）。
 * validHiddenIds 之外的隐藏 id 视为已删除/已归档的陈旧数据，沿用「拖拽即自清理」
 * 的既有语义，不回写进持久化顺序。没有隐藏项时结果与 visibleNext 完全一致，
 * 等价于直接替换，因此无筛选视图可以始终走这条合并路径。
 */
export function mergeManualOrderWithHidden(
  fullOrder: readonly string[] | undefined,
  visibleNext: readonly string[],
  validHiddenIds: ReadonlySet<string>,
): string[] {
  const persisted = fullOrder ?? []
  const visibleSet = new Set(visibleNext)
  const persistedSet = new Set(persisted)
  const result: string[] = []
  const emitted = new Set<string>()
  const emit = (id: string): void => {
    if (emitted.has(id)) return
    emitted.add(id)
    result.push(id)
  }
  // 新建未排序项在展示段最前（sortByManualOrder 的无秩项规则），合并后保持该相对位置。
  for (const id of visibleNext) {
    if (!persistedSet.has(id)) emit(id)
  }
  let cursor = 0
  for (const id of persisted) {
    if (!visibleSet.has(id)) {
      if (validHiddenIds.has(id)) emit(id)
      continue
    }
    while (cursor < visibleNext.length && visibleNext[cursor] !== id) {
      const nextVisible = visibleNext[cursor]
      if (nextVisible != null) emit(nextVisible)
      cursor += 1
    }
    if (visibleNext[cursor] === id) cursor += 1
    emit(id)
  }
  for (; cursor < visibleNext.length; cursor += 1) {
    const remaining = visibleNext[cursor]
    if (remaining != null) emit(remaining)
  }
  return result
}

export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return [...items]
  }
  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  if (moved == null) return [...items]
  next.splice(toIndex, 0, moved)
  return next
}

/** Preserves call order for durable writes while allowing callers to await their own result. */
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve()

  run(task: () => Promise<void>): Promise<void> {
    const result = this.tail.then(task, task)
    this.tail = result.catch(() => undefined)
    return result
  }
}
