import { useCallback, useEffect, useState } from 'react'

/** Custom title bar buttons for Windows/Linux frameless windows. */
export function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const api = window.spark
        if (!api?.invoke) return
        const res = await api.invoke('window:is-maximized', {})
        if (res?.maximized != null) setIsMaximized(res.maximized)
      } catch {
        // ignore window chrome state errors in test and preview environments
      }
    })()
  }, [])

  const handleMinimize = useCallback(() => {
    window.spark?.invoke?.('window:minimize', {}).catch(() => {})
  }, [])

  const handleMaximize = useCallback(async () => {
    try {
      const res = await window.spark?.invoke?.('window:maximize', {})
      if (res?.maximized != null) setIsMaximized(res.maximized)
    } catch {
      /* ignore */
    }
  }, [])

  const handleClose = useCallback(() => {
    window.spark?.invoke?.('window:close', {}).catch(() => {})
  }, [])

  return (
    <div className="window-controls">
      <button className="win-ctrl-btn minimize" onClick={handleMinimize} title="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        className="win-ctrl-btn maximize"
        onClick={handleMaximize}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect
              x="2"
              y="0"
              width="8"
              height="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
            <rect
              x="0"
              y="2"
              width="8"
              height="8"
              fill="var(--panel-elev)"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect
              x="0.5"
              y="0.5"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
        )}
      </button>
      <button className="win-ctrl-btn close" onClick={handleClose} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  )
}
