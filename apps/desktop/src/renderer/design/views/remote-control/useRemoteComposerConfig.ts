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

const catalogCache = new Map<string, { at: number; catalog: MobileBridgeCatalog }>()

/**
 * 同步取「这台设备最近一次拉到的目录」（未过期才算）。
 *
 * 新建会话要在创建后立刻 PATCH 上次记下的助手/模型/权限，那时手上没有目录：
 * 这里复用同一份缓存，避免为一个下拉框再拉一遍 /v1/catalog。
 */
export function readCachedCatalog(deviceId: string): MobileBridgeCatalog | null {
  const cached = catalogCache.get(deviceId)
  if (cached == null) return null
  return Date.now() - cached.at < CATALOG_TTL_MS ? cached.catalog : null
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
    call<MobileBridgeCatalog>(deviceId, 'GET', '/v1/catalog')
      .then((next) => {
        if (cancelled) return
        catalogCache.set(deviceId, { at: Date.now(), catalog: next })
        setCatalog(next)
        setCatalogSupported(true)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // 404 = 旧版目标端没有该端点 → 隐藏配置栏；其它错误只降级为「无目录」
        setCatalogSupported((cause as RemoteCallError | null)?.status !== 404)
        setCatalog(null)
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
