/**
 * 远程会话的运行时配置（助手 / 模型 / 权限 / 推理强度）。
 *
 * 数据来自目标端：
 *   GET  /v1/catalog                    目录（助手、渠道+模型、各 adapter 合法权限档、推理强度枚举）
 *   GET  /v1/sessions/:id/runtime       当前会话生效配置
 *   PATCH /v1/sessions/:id              写回 agentId / providerProfileId+modelId / permissionMode / reasoningEffort
 *
 * 目录按设备缓存 5 分钟（目录变化很慢，而每切一次会话都拉一遍纯属浪费中继流量）；
 * 运行时按会话拉一次，写回后就地合并，不重拉。
 * 旧版目标端没有 /v1/catalog → catalogSupported=false，调用方隐藏整条配置栏。
 */
import { useCallback, useEffect, useState } from 'react'
import type { MobileBridgeCatalog, MobileBridgeSessionRuntime } from '@spark/protocol'
import type { RemoteModelOption } from './remoteComposerModel'
import { rememberComposerPrefs } from './remoteViewState'
import { useRemoteCall, type RemoteCallError } from './useRemoteBridge'

const CATALOG_TTL_MS = 5 * 60_000
/**
 * 落盘目录的有效期。目录只在「新建会话套用上次偏好」时被读收敛用到，放宽到
 * 24h：重启后内存缓存为空，不落盘的话收敛直接放弃（patch 为空），新会话就
 * 回到目标端默认模型——「下次进来不是上次选的模型」的老毛病就是这么来的。
 */
const CATALOG_PERSISTED_TTL_MS = 24 * 3600_000
const CATALOG_STORAGE_KEY = 'spark-agent:remote-catalog-cache'

const catalogCache = new Map<string, { at: number; catalog: MobileBridgeCatalog }>()

function readPersistedCatalogTable(): Record<string, { at: number; catalog: MobileBridgeCatalog }> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CATALOG_STORAGE_KEY)
    if (raw == null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, { at: number; catalog: MobileBridgeCatalog }>
  } catch {
    return {}
  }
}

function persistCatalog(deviceId: string, catalog: MobileBridgeCatalog): void {
  if (typeof window === 'undefined') return
  try {
    // 只保留最近的几台设备，避免长期使用后无限膨胀
    const table = readPersistedCatalogTable()
    const entries = Object.entries(table).filter(([id, entry]) => {
      return id !== deviceId && entry != null && typeof entry === 'object'
    })
    const kept = entries.slice(-5)
    const next: Record<string, { at: number; catalog: MobileBridgeCatalog }> = {}
    for (const [id, entry] of kept) next[id] = entry
    next[deviceId] = { at: Date.now(), catalog }
    window.localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // 落盘失败不影响内存缓存；大不了重启后少一次「套用上次偏好」
  }
}

/**
 * 同步取「这台设备最近一次拉到的目录」（内存 5 分钟内，或落盘 24 小时内）。
 *
 * 新建会话要在创建后立刻 PATCH 上次记下的助手/模型/权限，那时手上没有目录：
 * 这里复用同一份缓存，避免为一个下拉框再拉一遍 /v1/catalog。重启后内存为空，
 * 从落盘兜底——否则新建会话的偏好套用会静默放弃。
 */
export function readCachedCatalog(deviceId: string): MobileBridgeCatalog | null {
  const cached = catalogCache.get(deviceId)
  if (cached != null && Date.now() - cached.at < CATALOG_TTL_MS) return cached.catalog
  const persisted = readPersistedCatalogTable()[deviceId]
  if (
    persisted != null &&
    typeof persisted === 'object' &&
    typeof persisted.at === 'number' &&
    persisted.catalog != null &&
    typeof persisted.catalog === 'object' &&
    Date.now() - persisted.at < CATALOG_PERSISTED_TTL_MS
  ) {
    return persisted.catalog
  }
  return null
}

export interface RemoteComposerConfigState {
  catalog: MobileBridgeCatalog | null
  runtime: MobileBridgeSessionRuntime | null
  /** 目标端是否提供 /v1/catalog */
  catalogSupported: boolean
  loading: boolean
  saving: boolean
  error: string | null
  setAgent: (agentId: string) => Promise<void>
  setModel: (option: RemoteModelOption) => Promise<void>
  setPermission: (mode: string) => Promise<void>
  /** 推理强度（minimal…max，档位以目录为准） */
  setReasoning: (effort: string) => Promise<void>
  /** 手动重试（目录或运行时拉取失败后） */
  reload: () => Promise<void>
  /** 外部写入（例如新建会话后由宿主注入） */
  patchLocal: (patch: MobileBridgeSessionRuntime) => void
}

interface RuntimeResponse {
  runtime?: MobileBridgeSessionRuntime
}

export function useRemoteComposerConfig(
  deviceId: string,
  sessionId: string | null,
): RemoteComposerConfigState {
  const call = useRemoteCall()
  const [catalog, setCatalog] = useState<MobileBridgeCatalog | null>(null)
  const [catalogSupported, setCatalogSupported] = useState(true)
  const [runtime, setRuntime] = useState<MobileBridgeSessionRuntime | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!deviceId) return
    let cancelled = false
    const cached = catalogCache.get(deviceId)
    if (cached != null && Date.now() - cached.at < CATALOG_TTL_MS) {
      setCatalog(cached.catalog)
      setCatalogSupported(true)
      return
    }
    // 内存过期先试落盘：有就先渲染（配置栏立即可用），网络回来后覆盖。
    // 落盘目录最多滞后 24h，chips 短暂显示旧模型名好过白等一趟中继往返。
    const persisted = readPersistedCatalogTable()[deviceId]
    const stale =
      persisted != null &&
      typeof persisted === 'object' &&
      typeof persisted.at === 'number' &&
      persisted.catalog != null &&
      typeof persisted.catalog === 'object'
        ? persisted.catalog
        : null
    if (stale != null) {
      setCatalog(stale)
      setCatalogSupported(true)
    }
    call<MobileBridgeCatalog>(deviceId, 'GET', '/v1/catalog')
      .then((next) => {
        if (cancelled) return
        catalogCache.set(deviceId, { at: Date.now(), catalog: next })
        persistCatalog(deviceId, next)
        setCatalog(next)
        setCatalogSupported(true)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // 404 = 旧版目标端没有该端点 → 隐藏配置栏；其它错误只降级为「无目录」。
        // 落盘目录还在时保留它（离线也能看到上次的渠道），只标记不支持写。
        if (stale == null) setCatalog(null)
        setCatalogSupported((cause as RemoteCallError | null)?.status !== 404)
      })
    return () => {
      cancelled = true
    }
  }, [call, deviceId, reloadToken])

  useEffect(() => {
    if (!sessionId) {
      setRuntime(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    call<RuntimeResponse>(deviceId, 'GET', `/v1/sessions/${encodeURIComponent(sessionId)}/runtime`)
      .then((response) => {
        if (cancelled) return
        setRuntime(response.runtime ?? {})
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // 旧版目标端可能没有 /runtime：退化为「未知配置」，chips 显示兜底文案
        setRuntime({})
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [call, deviceId, reloadToken, sessionId])

  const patchSession = useCallback(
    async (patch: Record<string, unknown>): Promise<boolean> => {
      if (!sessionId) return false
      setSaving(true)
      try {
        await call(deviceId, 'PATCH', `/v1/sessions/${encodeURIComponent(sessionId)}`, patch)
        setRuntime((previous) => ({ ...(previous ?? {}), ...patch }))
        setError(null)
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return false
      } finally {
        setSaving(false)
      }
    },
    [call, deviceId, sessionId],
  )

  const setAgent = useCallback(
    async (agentId: string) => {
      // 只写 agentId：adapter 与权限默认值由目标端按助手自身配置回退
      if (await patchSession({ agentId })) rememberComposerPrefs(deviceId, { agentId })
    },
    [deviceId, patchSession],
  )

  const setModel = useCallback(
    async (option: RemoteModelOption) => {
      const patch = { providerProfileId: option.providerProfileId, modelId: option.modelId }
      if (await patchSession(patch)) rememberComposerPrefs(deviceId, patch)
    },
    [deviceId, patchSession],
  )

  const setPermission = useCallback(
    async (mode: string) => {
      if (await patchSession({ permissionMode: mode })) {
        rememberComposerPrefs(deviceId, { permissionMode: mode })
      }
    },
    [deviceId, patchSession],
  )

  const setReasoning = useCallback(
    async (effort: string) => {
      // 档位合法性由目标端校验（不在目录里会 400），这里不做二次猜测
      if (await patchSession({ reasoningEffort: effort })) {
        rememberComposerPrefs(deviceId, { reasoningEffort: effort })
      }
    },
    [deviceId, patchSession],
  )

  const reload = useCallback(async () => {
    setReloadToken((value) => value + 1)
  }, [])

  const patchLocal = useCallback((patch: MobileBridgeSessionRuntime) => {
    setRuntime((previous) => ({ ...(previous ?? {}), ...patch }))
  }, [])

  return {
    catalog,
    runtime,
    catalogSupported,
    loading,
    saving,
    error,
    setAgent,
    setModel,
    setPermission,
    setReasoning,
    reload,
    patchLocal,
  }
}
