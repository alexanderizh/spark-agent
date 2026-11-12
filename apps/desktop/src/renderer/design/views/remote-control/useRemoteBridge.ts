/**
 * 远程操控的 IPC 封装。
 *
 * 主进程里 RemoteAgentRelayClient 已经具备 request/listDevices/subscribe 三件事，
 * 渲染端只需要一组薄封装：把「设备 + HTTP 语义」转成一次 invoke。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MobileBridgeEvent,
  RemoteAgentDeviceSummary,
  RemoteAgentRelayStatus,
} from '@spark/protocol'
import { useIpcInvoke, useIpcStream } from '../../hooks/useIpc'

const STOPPED_STATUS: RemoteAgentRelayStatus = {
  state: 'stopped',
  connected: false,
  connectionId: null,
  lastError: null,
  lastSeenAt: null,
}

export interface RemoteRelayState {
  status: RemoteAgentRelayStatus
  devices: RemoteAgentDeviceSummary[]
  /** 中继连接失败原因（未登录 / 网络 / 服务端），给视图直接提示 */
  error: string | null
  connecting: boolean
  refresh: (connectIfNeeded?: boolean) => Promise<void>
  /** 给设备起/改/清备注名（空串 = 清除），成功后设备列表就地更新 */
  setDeviceAlias: (deviceId: string, alias: string | null) => Promise<void>
}

/** 中继连接状态 + 在线设备列表（列表已由主进程过滤掉本机）。 */
export function useRemoteRelay(): RemoteRelayState {
  const [status, setStatus] = useState<RemoteAgentRelayStatus>(STOPPED_STATUS)
  const [devices, setDevices] = useState<RemoteAgentDeviceSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const { invoke: getStatus } = useIpcInvoke('remote-agent:relay:get-status')
  const { invoke: connectRelay } = useIpcInvoke('remote-agent:relay:connect')
  const { invoke: listDevices } = useIpcInvoke('remote-agent:relay:list-devices')
  const { invoke: setAlias } = useIpcInvoke('remote-agent:device:set-alias')

  useIpcStream('stream:remote-agent:relay-status', (payload) => {
    setStatus(payload)
    if (payload.connected) setError(null)
    else if (payload.lastError) setError(payload.lastError)
  })
  useIpcStream('stream:remote-agent:devices', (payload) => setDevices(payload.devices))

  const refresh = useCallback(
    async (connectIfNeeded = false) => {
      setConnecting(true)
      try {
        let next = await getStatus({})
        if (connectIfNeeded && !next.connected) {
          next = await connectRelay({})
        }
        setStatus(next)
        const list = await listDevices({})
        setDevices(list.devices)
        setError(next.lastError ?? null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setConnecting(false)
      }
    },
    [connectRelay, getStatus, listDevices],
  )

  useEffect(() => {
    void refresh(true)
  }, [refresh])

  const setDeviceAlias = useCallback(
    async (deviceId: string, alias: string | null) => {
      try {
        const next = await setAlias({ deviceId, alias })
        setDevices(next.devices)
        setError(null)
      } catch (cause) {
        // 同时置错误横幅与抛回调用方：视图层要 toast，断连态横幅也要能显示原因
        setError(cause instanceof Error ? cause.message : String(cause))
        throw cause instanceof Error ? cause : new Error(String(cause))
      }
    },
    [setAlias],
  )

  return { status, devices, error, connecting, refresh, setDeviceAlias }
}

export type RemoteCall = <T>(
  deviceId: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
) => Promise<T>

/** 远程调用失败：带上目标端 HTTP 状态码，便于区分「旧版端点 404」与真错误 */
export interface RemoteCallError extends Error {
  status?: number
}

/**
 * 通用远程调用。目标设备走 MobileBridgeService 的 /v1/* 语义路由，
 * 因此 /v1/projects、/v1/sessions/:id/messages、/v1/sessions/:id/turns 直接可用。
 */
export function useRemoteCall(): RemoteCall {
  const { invoke } = useIpcInvoke('remote-agent:target:request')

  return useCallback<RemoteCall>(
    async (deviceId, method, path, body) => {
      const response = await invoke({ deviceId, method, path, body })
      if (response.status < 200 || response.status >= 300) {
        const message =
          (response.body as { error?: { message?: string } } | null)?.error?.message ??
          `远程请求失败 (${response.status})`
        const error: RemoteCallError = new Error(message)
        error.status = response.status
        throw error
      }
      return response.body as never
    },
    [invoke],
  )
}

/**
 * 订阅某个远程会话的事件流。
 *
 * 订阅生命周期跟随 (deviceId, sessionId)：切换会话时先退订旧的再订阅新的，
 * 主进程侧有引用计数，重复订阅不会导致事件重复推送。
 */
export function useRemoteSessionStream(
  deviceId: string | null,
  sessionId: string | null,
  onEvents: (events: MobileBridgeEvent[]) => void,
): void {
  const { invoke: subscribe } = useIpcInvoke('remote-agent:stream:subscribe')
  const { invoke: unsubscribe } = useIpcInvoke('remote-agent:stream:unsubscribe')

  const handlerRef = useRef(onEvents)
  handlerRef.current = onEvents

  useIpcStream('stream:remote-agent:session-events', (payload) => {
    if (payload.deviceId !== deviceId || payload.sessionId !== sessionId) return
    handlerRef.current(payload.events)
  })

  useEffect(() => {
    if (!deviceId || !sessionId) return
    void subscribe({ deviceId, sessionId }).catch(() => undefined)
    return () => {
      void unsubscribe({ deviceId, sessionId }).catch(() => undefined)
    }
  }, [deviceId, sessionId, subscribe, unsubscribe])
}
