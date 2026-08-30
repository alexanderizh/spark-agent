import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { BrowserPanelDevtoolsBounds } from '@spark/protocol'

const DEFAULT_DEVTOOLS_HEIGHT = 300
const MIN_DEVTOOLS_HEIGHT = 160
const COMPACT_DEVTOOLS_HEIGHT = 96
const BROWSER_CONTROLS_HEIGHT = 70
const MIN_PAGE_VIEWPORT_HEIGHT = 120

interface UseBrowserPanelDevtoolsOptions {
  activeTabId: string | null
  browserRootRef: RefObject<HTMLDivElement | null>
  getActiveWebview: () => Electron.WebviewTag | null
  onOpenError: () => void
}

interface BrowserPanelDevtoolsController {
  isOpen: boolean
  height: number
  bodyRef: RefObject<HTMLDivElement | null>
  open: () => void
  close: () => void
  notifyWebviewReady: (tabId: string) => void
  onResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onResizePointerEnd: (event: ReactPointerEvent<HTMLDivElement>) => void
}

function readWebContentsId(webview: Electron.WebviewTag | null): number | null {
  if (webview == null) return null
  try {
    const id = webview.getWebContentsId()
    return Number.isSafeInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

export function readBrowserPanelDevtoolsBounds(
  element: HTMLElement | null,
): BrowserPanelDevtoolsBounds | null {
  if (element == null) return null
  const rect = element.getBoundingClientRect()
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (width < 1 || height < 1) return null
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
    width,
    height,
  }
}

export function clampBrowserDevtoolsHeight(height: number, browserRootHeight: number): number {
  const available = Math.max(
    COMPACT_DEVTOOLS_HEIGHT,
    Math.round(browserRootHeight) - BROWSER_CONTROLS_HEIGHT - MIN_PAGE_VIEWPORT_HEIGHT,
  )
  const minimum = Math.min(MIN_DEVTOOLS_HEIGHT, available)
  return Math.min(available, Math.max(minimum, Math.round(height)))
}

export function useBrowserPanelDevtools({
  activeTabId,
  browserRootRef,
  getActiveWebview,
  onOpenError,
}: UseBrowserPanelDevtoolsOptions): BrowserPanelDevtoolsController {
  const [isOpen, setIsOpen] = useState(false)
  const [height, setHeight] = useState(DEFAULT_DEVTOOLS_HEIGHT)
  const [readyVersion, setReadyVersion] = useState(0)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const targetTabIdRef = useRef<string | null>(null)
  const targetWebContentsIdRef = useRef<number | null>(null)
  const syncGenerationRef = useRef(0)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  const closeNativeView = useCallback(async (): Promise<void> => {
    await window.spark.invoke('browser-panel:devtools-close', {})
  }, [])

  const close = useCallback((): void => {
    syncGenerationRef.current += 1
    targetTabIdRef.current = null
    targetWebContentsIdRef.current = null
    setIsOpen(false)
    void closeNativeView().catch(() => {})
  }, [closeNativeView])

  const open = useCallback((): void => {
    if (readWebContentsId(getActiveWebview()) == null) {
      onOpenError()
      return
    }
    const rootHeight = browserRootRef.current?.getBoundingClientRect().height ?? 0
    setHeight((current) => clampBrowserDevtoolsHeight(current, rootHeight))
    setIsOpen(true)
    setReadyVersion((version) => version + 1)
  }, [browserRootRef, getActiveWebview, onOpenError])

  const notifyWebviewReady = useCallback(
    (tabId: string): void => {
      if (isOpen && tabId === activeTabId) {
        setReadyVersion((version) => version + 1)
      }
    },
    [activeTabId, isOpen],
  )

  useEffect(() => {
    if (!isOpen) return
    const generation = ++syncGenerationRef.current
    let disposed = false

    const syncTarget = async (): Promise<void> => {
      if (targetTabIdRef.current !== activeTabId) {
        targetTabIdRef.current = activeTabId
        targetWebContentsIdRef.current = null
        await closeNativeView().catch(() => {})
      }
      if (disposed || generation !== syncGenerationRef.current) return

      const webContentsId = readWebContentsId(getActiveWebview())
      const bounds = readBrowserPanelDevtoolsBounds(bodyRef.current)
      if (webContentsId == null || bounds == null) return

      const result = await window.spark.invoke('browser-panel:devtools-open', {
        webContentsId,
        bounds,
      })
      if (disposed || generation !== syncGenerationRef.current) return
      if (!result.success) {
        targetTabIdRef.current = null
        targetWebContentsIdRef.current = null
        setIsOpen(false)
        onOpenError()
        return
      }
      targetWebContentsIdRef.current = webContentsId
    }

    void syncTarget().catch(() => {
      if (disposed || generation !== syncGenerationRef.current) return
      targetTabIdRef.current = null
      targetWebContentsIdRef.current = null
      setIsOpen(false)
      onOpenError()
    })
    return () => {
      disposed = true
    }
  }, [activeTabId, closeNativeView, getActiveWebview, isOpen, onOpenError, readyVersion])

  useEffect(() => {
    if (!isOpen) return
    const body = bodyRef.current
    const root = browserRootRef.current
    if (body == null || root == null) return
    let animationFrame = 0

    const syncBounds = (): void => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        const bounds = readBrowserPanelDevtoolsBounds(bodyRef.current)
        if (targetWebContentsIdRef.current == null || bounds == null) return
        void window.spark.invoke('browser-panel:devtools-update-bounds', { bounds }).catch(() => {})
      })
    }
    const resizeObserver = new ResizeObserver(() => {
      const rootHeight = root.getBoundingClientRect().height
      setHeight((current) => clampBrowserDevtoolsHeight(current, rootHeight))
      syncBounds()
    })
    resizeObserver.observe(body)
    resizeObserver.observe(root)
    window.addEventListener('resize', syncBounds)
    window.addEventListener('scroll', syncBounds, true)
    syncBounds()
    return () => {
      window.cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      window.removeEventListener('resize', syncBounds)
      window.removeEventListener('scroll', syncBounds, true)
    }
  }, [browserRootRef, isOpen])

  useEffect(() => {
    return window.spark.on('stream:browser-panel:devtools-closed', ({ webContentsId }) => {
      if (targetWebContentsIdRef.current !== webContentsId) return
      syncGenerationRef.current += 1
      targetTabIdRef.current = null
      targetWebContentsIdRef.current = null
      setIsOpen(false)
    })
  }, [])

  useEffect(
    () => () => {
      syncGenerationRef.current += 1
      document.body.classList.remove('browser-devtools-resizing')
      void closeNativeView().catch(() => {})
    },
    [closeNativeView],
  )

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = { startY: event.clientY, startHeight: height }
      document.body.classList.add('browser-devtools-resizing')
    },
    [height],
  )

  const onResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current
      if (drag == null) return
      const rootHeight = browserRootRef.current?.getBoundingClientRect().height ?? 0
      setHeight(
        clampBrowserDevtoolsHeight(drag.startHeight + drag.startY - event.clientY, rootHeight),
      )
    },
    [browserRootRef],
  )

  const onResizePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture may already be released after the pointer leaves the window.
    }
    document.body.classList.remove('browser-devtools-resizing')
  }, [])

  return {
    isOpen,
    height,
    bodyRef,
    open,
    close,
    notifyWebviewReady,
    onResizePointerDown,
    onResizePointerMove,
    onResizePointerEnd,
  }
}
