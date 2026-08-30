import { useEffect } from 'react'

const RECONCILE_INTERVAL_MS = 2_000

/**
 * 后台任务主要靠 IPC 流事件驱动；只要界面仍认为有任务在运行，就周期性读取一次
 * 已持久化快照做最终一致性兜底。终态或卸载后立即停止，不形成常驻轮询。
 */
export function useAssetGenerationReconciliation(
  active: boolean,
  refreshSnapshot: () => Promise<void>,
  intervalMs = RECONCILE_INTERVAL_MS,
): void {
  useEffect(() => {
    if (!active) return

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const schedule = () => {
      timer = setTimeout(() => {
        void refreshSnapshot()
          .catch(() => undefined)
          .finally(() => {
            if (!disposed) schedule()
          })
      }, intervalMs)
    }

    schedule()
    return () => {
      disposed = true
      if (timer != null) clearTimeout(timer)
    }
  }, [active, intervalMs, refreshSnapshot])
}
