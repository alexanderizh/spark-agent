/**
 * useMemoryPendingCount — 「记忆待确认候选」未读角标计数
 *
 * 数据源 memory:candidate:list（全局待确认队列，不分 scope）。
 * 协议层没有候选变更推送事件，刷新走四路：mount、60s 轮询兜底、
 * refreshKey 变化（进入设置视图 / 切到记忆 section 时重挂触发）、
 * 以及监听 MEMORY_PENDING_CHANGED_EVENT（MemoryPanel 确认/忽略成功后 dispatch）。
 * IPC 失败静默保持上次值（角标是增强信息，不打扰用户）。
 */
import { useEffect, useState } from 'react'
import { useIpcInvoke } from './useIpc'

/** MemoryPanel 确认/忽略候选成功后广播；角标 hook 收到后立即重拉 */
export const MEMORY_PENDING_CHANGED_EVENT = 'spark:memory-pending-changed'

const POLL_INTERVAL_MS = 60_000

export function useMemoryPendingCount(refreshKey?: unknown): number {
  const { invoke: listCandidates } = useIpcInvoke('memory:candidate:list')
  const [count, setCount] = useState(0)

  useEffect(() => {
    let alive = true
    let busy = false
    const refresh = async () => {
      if (busy) return
      busy = true
      try {
        const res = await listCandidates({})
        if (!alive) return
        setCount(res?.ok ? (res.candidates?.length ?? 0) : 0)
      } catch {
        // 拉取失败静默：保持上次值，角标隐藏逻辑由 count<=0 兜底
      } finally {
        busy = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    const onChanged = () => void refresh()
    window.addEventListener(MEMORY_PENDING_CHANGED_EVENT, onChanged)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener(MEMORY_PENDING_CHANGED_EVENT, onChanged)
    }
    // refreshKey 变化（进入设置视图/切记忆 section）时重跑 effect = 立即刷新
  }, [listCandidates, refreshKey])

  return count
}
