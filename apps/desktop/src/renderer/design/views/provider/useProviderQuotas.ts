import { useCallback, useEffect, useRef, useState } from 'react'
import {
  detectProviderQuotaVendor,
  type ProviderProfile,
  type ProviderQuotaSnapshot,
} from '@spark/protocol'
import { useIpcInvoke } from '../../hooks/useIpc'

/**
 * Provider 卡片限额数据 hook。
 *
 * - 只对「限额注册表命中的渠道」发起 provider:quota 查询（与主进程同一注册表判定）
 * - auto=true（默认，渠道管理页）：每个渠道进入视图时自动查询一次
 * - auto=false（模型选择器悬浮卡）：不自动查询，由调用方在悬浮渠道时按需 refresh
 * - 禁用渠道跳过（卡片本身就是置灰态）；查询失败保留错误信息供卡片展示重试入口
 */
export function useProviderQuotas(
  profiles: ProviderProfile[],
  options?: { auto?: boolean | undefined },
) {
  const { invoke: fetchQuota } = useIpcInvoke('provider:quota')
  const [quotaMap, setQuotaMap] = useState<Record<string, ProviderQuotaSnapshot>>({})
  const [errorMap, setErrorMap] = useState<Record<string, string>>({})
  const [pendingSet, setPendingSet] = useState<Set<string>>(new Set())
  const inFlightRef = useRef<Map<string, Promise<void>>>(new Map())
  /** 已自动查询过的渠道（手动刷新不受限） */
  const autoFetchedRef = useRef<Set<string>>(new Set())

  const refresh = useCallback(
    (id: string) => {
      const inFlight = inFlightRef.current.get(id)
      if (inFlight != null) return inFlight

      setPendingSet((prev) => new Set(prev).add(id))
      const request = (async () => {
        try {
          const r = await fetchQuota({ id })
          setQuotaMap((prev) => {
            const next = { ...prev }
            delete next[id]
            if (r.quota) next[id] = r.quota
            return next
          })
          setErrorMap((prev) => {
            if (!r.errorMessage) {
              if (!(id in prev)) return prev
              const next = { ...prev }
              delete next[id]
              return next
            }
            return { ...prev, [id]: r.errorMessage }
          })
        } catch (err) {
          setErrorMap((prev) => ({
            ...prev,
            [id]: err instanceof Error ? err.message : String(err),
          }))
        } finally {
          inFlightRef.current.delete(id)
          setPendingSet((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        }
      })()
      inFlightRef.current.set(id, request)
      return request
    },
    [fetchQuota],
  )

  const auto = options?.auto !== false

  useEffect(() => {
    if (!auto) return
    const supported = profiles.filter((p) => {
      if (p.enabled === false || p.managed === true) return false
      if (p.providerType === 'auto-router') return false
      return detectProviderQuotaVendor({ name: p.name, apiEndpoint: p.apiEndpoint }) !== null
    })
    for (const p of supported) {
      if (autoFetchedRef.current.has(p.id)) continue
      autoFetchedRef.current.add(p.id)
      void refresh(p.id)
    }
  }, [auto, profiles, refresh])

  const refreshAll = useCallback(() => {
    for (const id of Object.keys(quotaMap)) void refresh(id)
    for (const id of Object.keys(errorMap)) void refresh(id)
  }, [quotaMap, errorMap, refresh])

  return { quotaMap, errorMap, pendingSet, refresh, refreshAll }
}
