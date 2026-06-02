/**
 * BrowserPanelView — Side panel with an EMBEDDED browser (webview tag).
 *
 * Modes (mutually exclusive):
 *   1. **Inline mode** (default): <webview> renders pages directly inside
 *      the sidebar. User types a URL → page loads right there.
 *   2. **Pop-out mode**: sidebar hides, independent browser window appears
 *      with its own address bar. Closing the window returns to inline mode.
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import type { ReactElement, FormEvent } from 'react'
import type { PlaywrightStatusResponse } from '@spark/protocol'
import { Icons } from '../Icons'
import { useApp, BROWSER_PANEL_WIDTH_MIN, BROWSER_PANEL_WIDTH_MAX } from '../AppContext'

const DEFAULT_URL = 'https://www.yiqibyte.com'

interface ViewState {
  title: string | null
  url: string | null
}

/** Normalize a user-typed string into a loadable URL. */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return DEFAULT_URL
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.\w{2,}/.test(trimmed)) return `https://${trimmed}`
  return `https://${trimmed}`
}

export function BrowserPanelView(): ReactElement | null {
  const { t, setTweak } = useApp()
  const [status, setStatus] = useState<PlaywrightStatusResponse | null>(null)
  const [view, setView] = useState<ViewState>({ title: null, url: null })
  const [open, setOpen] = useState(false)
  const [urlInput, setUrlInput] = useState(DEFAULT_URL)
  const [poppedOut, setPoppedOut] = useState(false)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const panelOpenTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync local `open` from AppContext tweak
  useEffect(() => {
    setOpen(t.browserPanelOpen)
  }, [t.browserPanelOpen])

  // Load initial status + subscribe to status updates
  useEffect(() => {
    const loadStatus = async (): Promise<void> => {
      try {
        const s = await window.spark.invoke('playwright:status', {})
        setStatus(s)
      } catch (err) {
        console.warn('[browser-panel] failed to load status:', err)
      }
    }
    void loadStatus()
    const unsub = window.spark?.on(
      'stream:playwright:status',
      (payload: PlaywrightStatusResponse) => {
        setStatus(payload)
      },
    )
    return unsub ?? (() => {})
  }, [])

  // Listen for pop-out window closing → restore sidebar
  useEffect(() => {
    const unsub = window.spark?.on(
      'stream:playwright:status',
      (payload: PlaywrightStatusResponse) => {
        if (poppedOut && !payload.viewOpen) {
          setPoppedOut(false)
          if (panelOpenTimer.current != null) clearTimeout(panelOpenTimer.current)
          panelOpenTimer.current = setTimeout(() => {
            setTweak('browserPanelOpen', true)
          }, 150)
        }
      },
    )
    return unsub ?? (() => {})
  }, [poppedOut, setTweak])

  // ─── Webview lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    const wv = webviewRef.current
    if (wv == null) return

    const onNav = (): void => {
      const url = wv.getURL()
      const title = wv.getTitle()
      setView({ url, title })
      setUrlInput(url === 'about:blank' ? '' : url)
    }
    const onTitle = (): void => {
      setView((prev) => ({ ...prev, title: wv.getTitle() }))
    }
    // Block devtools from opening in the webview
    const onDevtools = (e: Event): void => {
      e.preventDefault()
    }

    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('devtools-opened', onDevtools)

    return () => {
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('devtools-opened', onDevtools)
    }
  }, [open, poppedOut])

  // ─── Resize handle ──────────────────────────────────────────────────
  // Two tricks to make this smooth:
  //   1. While dragging, render a full-screen invisible overlay that captures
  //      mouse events — without it, the cursor leaves the resize handle and
  //      enters the <webview>, which is a separate guest process and steals
  //      pointer events, causing lost mouseup / runaway drags.
  //   2. Throttle width updates via requestAnimationFrame instead of writing
  //      on every mousemove. setTweak triggers re-render of the whole shell.
  const [dragging, setDragging] = useState(false)
  const dragState = useRef<{
    startX: number
    startWidth: number
    latestWidth: number
    rafId: number | null
  } | null>(null)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragState.current = {
        startX: e.clientX,
        startWidth: t.browserPanelWidth,
        latestWidth: t.browserPanelWidth,
        rafId: null,
      }
      setDragging(true)
      const onMove = (ev: MouseEvent): void => {
        const s = dragState.current
        if (s == null) return
        const delta = s.startX - ev.clientX
        const next = Math.max(
          BROWSER_PANEL_WIDTH_MIN,
          Math.min(BROWSER_PANEL_WIDTH_MAX, s.startWidth + delta),
        )
        s.latestWidth = next
        if (s.rafId == null) {
          s.rafId = window.requestAnimationFrame(() => {
            const cur = dragState.current
            if (cur == null) return
            cur.rafId = null
            setTweak('browserPanelWidth', cur.latestWidth)
          })
        }
      }
      const onUp = (): void => {
        const s = dragState.current
        if (s?.rafId != null) window.cancelAnimationFrame(s.rafId)
        if (s != null) setTweak('browserPanelWidth', s.latestWidth)
        dragState.current = null
        setDragging(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [t.browserPanelWidth, setTweak],
  )

  // ─── Actions ────────────────────────────────────────────────────────

  /** Navigate the embedded webview to a URL */
  const handleNavigate = (e?: FormEvent): void => {
    e?.preventDefault()
    const raw = urlInput.trim()
    if (raw.length === 0) return
    const url = normalizeUrl(raw)
    webviewRef.current?.loadURL(url)
  }

  /** Pop out: hide sidebar, show independent browser window */
  const handlePopOut = async (): Promise<void> => {
    const currentUrl = view.url
    const url = (currentUrl != null && currentUrl !== 'about:blank')
      ? currentUrl
      : (urlInput.trim().length > 0 ? normalizeUrl(urlInput.trim()) : undefined)
    setPoppedOut(true)
    setTweak('browserPanelOpen', false)
    await window.spark.invoke('browser:pop-out', url != null ? { url } : {})
  }

  /** Pop back in: close independent window, restore sidebar */
  const handlePopIn = async (): Promise<void> => {
    setPoppedOut(false)
    setTweak('browserPanelOpen', true)
    await window.spark.invoke('browser:pop-in', {})
  }

  const handleTogglePanel = (): void => {
    setTweak('browserPanelOpen', false)
  }

  if (status == null || !open) {
    return null
  }

  return (
    <aside
      className={`browser-panel${dragging ? ' is-dragging' : ''}`}
      style={{ width: t.browserPanelWidth }}
    >
      {/* Left-edge resize handle */}
      <div
        className="browser-panel-resize-handle"
        onMouseDown={handleMouseDown}
        title="拖拽调整宽度"
      />
      {/* While dragging, this overlay covers the entire window so the webview
          (a separate guest process) can't steal pointer events. */}
      {dragging && <div className="browser-panel-drag-overlay" />}

      <div className="browser-panel-header">
        <div className="browser-panel-title">
          <Icons.Globe size={14} />
          <span>浏览器</span>
        </div>
        <div className="browser-panel-actions">
          <button className="icon-btn" onClick={handlePopOut} title="独立窗口显示">
            <Icons.ExternalLink size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={handleTogglePanel}
            title="隐藏面板"
          >
            <Icons.PanelRight size={14} />
          </button>
        </div>
      </div>

      <form className="browser-panel-urlbar" onSubmit={handleNavigate}>
        <input
          type="text"
          placeholder="输入网址…"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
        />
        <button type="submit" disabled={urlInput.trim().length === 0}>
          打开
        </button>
      </form>

      <div className="browser-panel-viewport">
        <webview
          ref={webviewRef as React.LegacyRef<Electron.WebviewTag>}
          src={DEFAULT_URL}
          className="browser-panel-webview"
          partition="persist:browser-automation"
          allowpopups={false}
        />
      </div>

      {view.title != null && view.title !== '' && (
        <div className="browser-panel-footer">
          <span className="browser-panel-pagetitle" title={view.title ?? ''}>
            {view.title}
          </span>
        </div>
      )}

      {status.lastError != null && (
        <div className="browser-panel-error" title={status.lastError}>
          <Icons.AlertTriangle size={12} />
          <span>错误：{status.lastError.slice(0, 60)}</span>
        </div>
      )}
    </aside>
  )
}
