import { useState, useCallback, useEffect, useRef } from 'react'
import type { IpcChannel, IpcRequest, IpcResponse, IpcStreamChannel, IpcStreamPayload } from '@spark/protocol'

export function useIpcInvoke<C extends IpcChannel>(channel: C) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const invoke = useCallback(async (request: IpcRequest<C>): Promise<IpcResponse<C>> => {
    setLoading(true)
    setError(null)
    try {
      return await window.spark.invoke(channel, request)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [channel])

  return { invoke, loading, error }
}

export function useIpcStream<C extends IpcStreamChannel>(
  channel: C,
  callback: (payload: IpcStreamPayload<C>) => void,
  _deps: unknown[] = [],
) {
  // 使用 ref 持有最新 callback，使订阅只依赖 channel，不会因 callback/deps 变化而重订阅。
  // 这避免了 off→on 间隙导致的事件丢失问题。
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    const stableCallback = (payload: IpcStreamPayload<C>) => callbackRef.current(payload)
    const unsubscribe = window.spark.on(channel, stableCallback)
    return unsubscribe
  }, [channel])
}
