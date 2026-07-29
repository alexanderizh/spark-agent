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
