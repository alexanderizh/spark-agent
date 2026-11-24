/**
 * 远程会话运行配置（远程配置面板数据源，2026-11-25 对齐本地 ChatConfigPanel）。
 *
 * 数据来自目标端：
 *   GET  /v1/sessions/:id/runtime-config   prompt / env / prompt-filter 三层聚合读
 *   PUT  /v1/runtime-config/prompt          {scope,scopeRef,value:{enabled,content}}
 *   PUT  /v1/runtime-config/env             {scope,scopeRef,value:{enabled,vars}}
 *   PUT  /v1/runtime-config/prompt-filter   {scope,scopeRef,disabledSources}
 *
 * 写回后重新 GET（本地面板同款语义）：update 响应只含被写层，完整双层态以重新
 * 读取为准。旧版目标端 404 → unsupported，面板渲染降级提示。
 */
import { useCallback, useEffect, useState } from 'react'
import type {
  EnvVarItem,
  MobileBridgeSessionRuntimeConfigResponse,
} from '@spark/protocol'
import { useRemoteCall } from './useRemoteBridge'

export type RemoteRuntimeConfigScope = 'project' | 'session'

export interface RemoteSessionRuntimeConfigState {
  config: MobileBridgeSessionRuntimeConfigResponse | null
  loading: boolean
  saving: boolean
  error: string | null
  /** 目标端是否提供 /v1/sessions/:id/runtime-config（旧版 404 → false） */
  supported: boolean
  /** 保存项目/会话提示词（enabled 由内容非空推导，语义同本地面板） */
  savePrompt: (scope: RemoteRuntimeConfigScope, content: string) => Promise<boolean>
  /**
   * 保存项目/会话环境变量（仅保留键名非空条目，语义同本地面板）。
   * silent 路径用于失焦/增删自动保存：不切 saving 状态、不重拉全量配置，
   * 避免高频自动保存打断其它字段的草稿输入（与本地面板 silent 语义一致）。
   */
  saveEnv: (
    scope: RemoteRuntimeConfigScope,
    vars: EnvVarItem[],
    options?: { silent?: boolean },
  ) => Promise<boolean>
  /** 保存过滤层；disabledSources 传 undefined = 删除该层（会话层恢复继承项目层） */
  saveFilter: (
    scope: RemoteRuntimeConfigScope,
    disabledSources: string[] | undefined,
  ) => Promise<boolean>
  reload: () => void
}

export function useRemoteSessionRuntimeConfig(
  deviceId: string,
  sessionId: string | null,
): RemoteSessionRuntimeConfigState {
  const call = useRemoteCall()
  const [config, setConfig] = useState<MobileBridgeSessionRuntimeConfigResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [supported, setSupported] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!deviceId || sessionId == null) {
      setConfig(null)
      setError(null)
      setSupported(true)
      return
    }
    let cancelled = false
    setLoading(true)
    call<MobileBridgeSessionRuntimeConfigResponse>(
      deviceId,
      'GET',
      `/v1/sessions/${encodeURIComponent(sessionId)}/runtime-config`,
    )
      .then((response) => {
        if (cancelled) return
        setConfig(response)
        setError(null)
        setSupported(true)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setConfig(null)
        setSupported((cause as { status?: number } | null)?.status !== 404)
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [call, deviceId, sessionId, reloadToken])

  const reload = useCallback(() => {
    setReloadToken((value) => value + 1)
  }, [])

  const putLayer = useCallback(
    async (
      kind: 'prompt' | 'env' | 'prompt-filter',
      scope: RemoteRuntimeConfigScope,
      body: Record<string, unknown>,
      options?: { silent?: boolean },
    ): Promise<boolean> => {
      if (options?.silent !== true) setSaving(true)
      try {
        await call(deviceId, 'PUT', `/v1/runtime-config/${kind}`, {
          scope,
          scopeRef: scope === 'session' ? sessionId : config?.workspaceId ?? '',
          ...body,
        })
        return true
      } catch (cause) {
        // 失败必须可见（本地面板同款注释：silent 静默丢失会误导「已保存」）
        if (options?.silent) {
          console.warn('[remote env] silent save failed', cause)
        } else {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
        return false
      } finally {
        if (options?.silent !== true) setSaving(false)
      }
    },
    [call, config?.workspaceId, deviceId, sessionId],
  )

  const savePrompt = useCallback(
    async (scope: RemoteRuntimeConfigScope, content: string) => {
      const saved = await putLayer('prompt', scope, {
        value: { enabled: content.trim().length > 0, content },
      })
      if (saved) reload()
      return saved
    },
    [putLayer, reload],
  )

  const saveEnv = useCallback(
    async (scope: RemoteRuntimeConfigScope, vars: EnvVarItem[], options?: { silent?: boolean }) => {
      // 仅保留键名非空的条目（trim 后），语义同本地面板 saveEnvLayer
      const cleaned = vars
        .map((item) => ({
          key: item.key.trim(),
          value: item.value,
          ...(item.description != null && item.description.trim().length > 0
            ? { description: item.description.trim() }
            : {}),
        }))
        .filter((item) => item.key.length > 0)
      const saved = await putLayer(
        'env',
        scope,
        { value: { enabled: true, vars: cleaned } },
        options,
      )
      if (saved && options?.silent !== true) reload()
      return saved
    },
    [putLayer, reload],
  )

  const saveFilter = useCallback(
    async (scope: RemoteRuntimeConfigScope, disabledSources: string[] | undefined) => {
      const saved = await putLayer('prompt-filter', scope, { disabledSources })
      if (saved) reload()
      return saved
    },
    [putLayer, reload],
  )

  return { config, loading, saving, error, supported, savePrompt, saveEnv, saveFilter, reload }
}
