/**
 * Agent 配置里 Skills / MCP / 规则等资源都以「ID 数组」形式挂在 agent 上。
 * 当某个资源在别处被删除时，不会级联清理引用它的 agent，于是这些数组里会残留
 * 「悬空 ID」。计数若直接用 `ids.length`，就会把已删除的资源也算进去，导致数字
 * 大于实际可见的 chip 数量（例如显示 3 个 MCP 但只剩 playwright 一个）。
 *
 * 这里统一以「仍然存在的资源」为准来计数与过滤，作为对悬空引用的展示层兜底，
 * 且随资源增删自动自愈，不改动持久化数据。
 */

/** 统计 `ids` 中仍存在于 `items` 的数量（忽略已删除资源留下的悬空 ID）。 */
export function countExistingRefs(ids: string[], items: readonly { id: string }[]): number {
  if (ids.length === 0) return 0
  const known = new Set(items.map((item) => item.id))
  return ids.filter((id) => known.has(id)).length
}

/**
 * 按 `ids` 的顺序解析出仍存在的资源对象，丢弃悬空 ID。
 * 用于预览 chip：先过滤再切片，避免悬空 ID 占位渲染成空白、并让「+N」计数正确。
 */
export function resolveExistingRefs<T extends { id: string }>(
  ids: string[],
  items: readonly T[],
): T[] {
  if (ids.length === 0) return []
  const byId = new Map(items.map((item) => [item.id, item]))
  const resolved: T[] = []
  for (const id of ids) {
    const item = byId.get(id)
    if (item) resolved.push(item)
  }
  return resolved
}
