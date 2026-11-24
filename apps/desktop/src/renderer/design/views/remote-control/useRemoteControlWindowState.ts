import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@spark/shared'
import type { RemoteControlWindowState } from '@spark/protocol'

const logger = createLogger('remote-control-window-ui')

export function useRemoteControlWindowState(): boolean {
  const [isOpen, setIsOpen] = useState(false)
  const revisionRef = useRef(-1)

  useEffect(() => {
    let active = true
    const applyState = (state: RemoteControlWindowState): void => {
      if (!active || state.revision <= revisionRef.current) return
      revisionRef.current = state.revision
      setIsOpen(state.open)
    }

    const api = window.spark
    const unsubscribe = api?.on('stream:remote-control:window-state', applyState) ?? (() => {})
    api
      ?.invoke('remote-control:window:get-state', {})
      .then(applyState)
      .catch((error: unknown) => {
        logger.warn('Failed to read remote control window state', {
          message: error instanceof Error ? error.message : String(error),
        })
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return isOpen
}
