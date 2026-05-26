import { useState, useCallback, useEffect } from 'react'
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
  deps: unknown[] = [],
) {
  useEffect(() => {
    const unsubscribe = window.spark.on(channel, callback)
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, ...deps])
}
