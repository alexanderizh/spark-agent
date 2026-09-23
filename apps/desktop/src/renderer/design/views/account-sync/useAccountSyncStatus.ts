import { useCallback, useEffect, useState } from 'react'
import type { AccountSyncStatus } from '@spark/protocol'
import { getAccountSyncStatus } from './account-sync-client'

interface UseAccountSyncStatusResult {
  status: AccountSyncStatus | null
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * 同步余量状态Hook：设置页操作行与账号中心面板共用。
 *
 * 未登录（accountKey 为 null）时不发请求；主进程在服务端不支持或请求失败时
 * 回退保守默认上限并标记 `source: 'fallback'`，因此这里永不抛错。
 */
export function useAccountSyncStatus(accountKey: string | null): UseAccountSyncStatusResult {
  const [status, setStatus] = useState<AccountSyncStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (accountKey == null) {
      setStatus(null)
      return
    }
    setLoading(true)
    try {
      setStatus(await getAccountSyncStatus())
    } catch {
      // 主进程已保证不回退失败；双保险避免状态卡在 loading
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [accountKey])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { status, loading, refresh }
}
