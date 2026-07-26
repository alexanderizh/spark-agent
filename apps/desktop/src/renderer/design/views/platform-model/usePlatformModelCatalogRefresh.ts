import { useCallback, useEffect } from 'react'
import { useToast } from '../../components/Toast'
import { useIpcInvoke } from '../../hooks/useIpc'

export function usePlatformModelCatalogRefresh(reloadLocal: () => void): {
  refreshPlatformCatalog: () => Promise<void>
} {
  const { toast } = useToast()
  const { invoke } = useIpcInvoke('platform-model:refresh-catalog')

  const sync = useCallback(
    async (force: boolean, notifyError: boolean): Promise<void> => {
      try {
        await invoke({ force })
      } catch (error) {
        if (notifyError) {
          toast.error(error instanceof Error ? error.message : '平台模型目录刷新失败')
        } else {
          console.warn('[platform-model] automatic catalog refresh failed:', error)
        }
      } finally {
        // 无论平台是否在线，都要展示本地已持久化 Provider，离线不能清空页面。
        reloadLocal()
      }
    },
    [invoke, reloadLocal, toast],
  )

  useEffect(() => {
    void sync(false, false)
  }, [sync])

  useEffect(() => {
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void sync(false, false)
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [sync])

  const refreshPlatformCatalog = useCallback(() => sync(true, true), [sync])

  return { refreshPlatformCatalog }
}
