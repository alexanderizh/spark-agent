/**
 * MemoryPendingBadge — 「记忆待确认候选」未读角标
 *
 * 内部自带 useMemoryPendingCount（mount/轮询/refreshKey/CustomEvent 四路刷新），
 * 挂载点只负责渲染：count <= 0（含拉取失败）时不渲染任何 DOM。
 * 两处挂载：主侧栏底部「设置」按钮（绝对定位右上角）、设置页导航「记忆」项（行尾内联）。
 */
import { useMemoryPendingCount } from './hooks/useMemoryPendingCount'

export function MemoryPendingBadge({ refreshKey }: { refreshKey?: unknown }) {
  const count = useMemoryPendingCount(refreshKey)
  if (count <= 0) return null
  return (
    <span className="memory-pending-badge" aria-label={`${count} 条记忆候选待确认`}>
      {count > 99 ? '99+' : count}
    </span>
  )
}
