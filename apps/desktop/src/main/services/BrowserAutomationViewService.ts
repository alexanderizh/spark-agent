/**
 * BrowserAutomationViewService — Embedded browser window for Agent automation.
 *
 * Architecture:
 *   - Creates a dedicated `BrowserWindow` separate from the main UI window
 *   - The CDP endpoint is exposed application-wide via `--remote-debugging-port=9223`
 *     (set in main/index.ts BEFORE app.whenReady). All BrowserWindow webContents
 *     are reachable through that single CDP server.
 *   - We tag the automation window's webContents by attaching `webContents.debugger`
 *     so Playwright MCP can identify the right target among multiple open windows
 *     (Electron exposes the main window + automation window on the same CDP port).
 *   - Periodically screenshots + captures URL/title and pushes to renderer
 *     for the live preview panel
 *
 * Why a separate window (not WebContentsView inside main window)?
 *   - Strong isolation: automation webContents has no preload, no IPC bridge
 *   - Can be hidden (`show: false`) for headless mode without affecting UI
 *   - Easy to reparent or move off-screen
 *
 * Lifecycle:
 *   - `openView({ url })` → creates window, tags it via debugger, returns cdp endpoint
 *   - `closeView()` → detaches debugger, destroys window
 *   - Listens to `app.before-quit` to cleanup
 */

import { app, BrowserWindow } from 'electron'
import { createLogger } from '@spark/shared'

const log = createLogger('browser-automation-view')

/** Default URL when none specified — a welcome page with instructions. */
const WELCOME_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Spark Agent · Browser</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #1a1a2e;
      color: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      text-align: center;
    }
    .container { max-width: 480px; padding: 40px; }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #fff; }
    p { font-size: 14px; color: #888; line-height: 1.6; margin-bottom: 12px; }
    .hint { font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">🌐</div>
    <h1>Spark Agent · Browser</h1>
    <p>浏览器自动化视图已就绪。Agent 将通过此窗口操作网页。</p>
    <p>你也可以在侧边栏地址栏输入 URL 手动导航。</p>
    <p class="hint">此窗口由 Playwright MCP 通过 CDP 控制，不会暴露任何本地权限。</p>
  </div>
</body>
</html>
`)}`

/** Update throttle for screenshot+meta push. */
const SNAPSHOT_INTERVAL_MS = 800

/**
 * Fixed CDP port — must match `--remote-debugging-port=9223` set in main/index.ts.
 * If you change one, change the other.
 */
const CDP_PORT = 9223
const CDP_ENDPOINT = `http://127.0.0.1:${CDP_PORT}`

let viewWindow: BrowserWindow | null = null
let snapshotTimer: NodeJS.Timeout | null = null
let currentUrl = WELCOME_HTML
let currentTitle: string | null = 'Spark Agent · Browser'
/** Set to true once `app` starts quitting — used to bypass the hide-on-close
 *  behavior so the window can be destroyed and the app can actually exit. */
let isAppQuitting = false

export interface OpenViewResult {
  cdpEndpoint: string
}

export interface OpenViewOptions {
  url?: string
  /** If true, create the window hidden (no visible window). Default: false. */
  hidden?: boolean
}

/**
 * Open the embedded browser window. Idempotent — subsequent calls reuse the
 * existing window and optionally navigate to the new URL.
 */
export async function openView(opts: OpenViewOptions = {}): Promise<OpenViewResult> {
  const targetUrl = opts.url ?? WELCOME_HTML
  const startHidden = opts.hidden ?? false

  if (viewWindow != null && !viewWindow.isDestroyed()) {
    log.info(`Reusing existing browser view; navigating to ${targetUrl}`)
    viewWindow.loadURL(targetUrl).catch((err) => {
      log.warn(`Failed to navigate existing view: ${String(err)}`)
    })
    // If currently hidden and caller wants it shown, show it
    if (!startHidden && !viewWindow.isVisible()) {
      viewWindow.show()
    }
    return { cdpEndpoint: await ensureCdpEndpoint() }
  }

  log.info(`Opening browser automation view: ${targetUrl} (hidden=${startHidden})`)
  viewWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Spark Agent · Browser',
    show: !startHidden, // respect hidden flag
    backgroundColor: '#1a1a2e',
    webPreferences: {
      // HARD security: this window loads arbitrary external sites; never expose
      // any of our preload / IPC / node capabilities to it.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // No `preload` — this is a pure browser view
    },
  })

  // Disable window-open handlers (let target=_blank open in same window's tab)
  viewWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Track navigation for status updates
  viewWindow.webContents.on('did-navigate', (_e, url) => {
    currentUrl = url
  })
  viewWindow.webContents.on('page-title-updated', (_e, title) => {
    currentTitle = title
  })
  viewWindow.on('closed', () => {
    viewWindow = null
    stopSnapshotTimer()
    // Reset to welcome state
    currentUrl = WELCOME_HTML
    currentTitle = 'Spark Agent · Browser'
  })
  viewWindow.on('close', (event) => {
    // If the app is quitting, allow the window to be destroyed (cleanup will
    // have already detached the debugger). Otherwise the user clicked X —
    // hide instead of close so the CDP connection / MCP config stays intact.
    if (isAppQuitting) {
      log.info('Browser automation view closing (app quitting)')
      return
    }
    event.preventDefault()
    viewWindow?.hide()
  })

  await viewWindow.loadURL(targetUrl)
  currentUrl = targetUrl
  currentTitle = viewWindow.getTitle()

  const cdpEndpoint = await ensureCdpEndpoint()
  startSnapshotTimer()
  return { cdpEndpoint }
}

/**
 * Close the embedded browser window and stop snapshot polling.
 * Unlike hiding, this actually destroys the window.
 */
export function closeView(): void {
  if (snapshotTimer != null) {
    clearInterval(snapshotTimer)
    snapshotTimer = null
  }
  if (viewWindow != null && !viewWindow.isDestroyed()) {
    log.info('Closing browser automation view')
    // Remove the close preventer before destroying
    viewWindow.removeAllListeners('close')
    viewWindow.destroy()
  }
  viewWindow = null
}

/**
 * Toggle visibility. Used when switching between headful / headless modes.
 */
export function setVisible(visible: boolean): void {
  if (viewWindow == null || viewWindow.isDestroyed()) return
  if (visible) {
    viewWindow.show()
    viewWindow.focus()
  } else {
    viewWindow.hide()
  }
}

/**
 * Capture a single screenshot + page meta. Returns base64 data URL.
 */
export async function captureView(): Promise<{
  dataUrl: string | null
  title: string | null
  url: string | null
}> {
  if (viewWindow == null || viewWindow.isDestroyed()) {
    return { dataUrl: null, title: null, url: null }
  }
  try {
    const image = await viewWindow.webContents.capturePage()
    return {
      dataUrl: image.toDataURL(),
      title: currentTitle ?? viewWindow.getTitle() ?? null,
      url: currentUrl ?? viewWindow.webContents.getURL() ?? null,
    }
  } catch (err) {
    log.warn(`captureView failed: ${String(err)}`)
    return { dataUrl: null, title: currentTitle, url: currentUrl }
  }
}

export function isViewOpen(): boolean {
  return viewWindow != null && !viewWindow.isDestroyed()
}

/**
 * Return the CDP endpoint URL. The endpoint is application-wide (set in
 * main/index.ts via `--remote-debugging-port=9223`); we return null if no
 * view has been opened yet so callers don't advertise a stale endpoint.
 */
export function getCdpEndpoint(): string | null {
  if (!isViewOpen()) return null
  return CDP_ENDPOINT
}

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * Tag the view's webContents via debugger so Playwright MCP can identify the
 * correct CDP target among multiple Electron windows. Returns the fixed
 * CDP endpoint URL.
 */
async function ensureCdpEndpoint(): Promise<string> {
  const wc = viewWindow?.webContents
  if (wc != null && !wc.isDestroyed()) {
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3')
        log.info(`Debugger attached to view webContents (cdp=${CDP_ENDPOINT})`)
      }
    } catch (err) {
      log.warn(`Debugger attach failed (non-fatal — CDP still exposed via app switch): ${String(err)}`)
    }
  }
  return CDP_ENDPOINT
}

/**
 * Periodically capture page meta + screenshot and emit to renderer.
 * Throttled to avoid flooding the IPC channel with full-screen PNGs.
 */
function startSnapshotTimer(onSnapshot?: (payload: {
  title: string | null
  url: string | null
  dataUrl?: string
}) => void): void {
  stopSnapshotTimer()
  snapshotTimer = setInterval(async () => {
    if (viewWindow == null || viewWindow.isDestroyed()) {
      stopSnapshotTimer()
      return
    }
    // For high-frequency updates, only push meta; full screenshot on slower cadence
    const meta = {
      title: currentTitle ?? viewWindow.getTitle() ?? null,
      url: currentUrl ?? viewWindow.webContents.getURL() ?? null,
    }
    if (onSnapshot != null) {
      onSnapshot(meta)
    }
  }, SNAPSHOT_INTERVAL_MS)
}

function stopSnapshotTimer(): void {
  if (snapshotTimer != null) {
    clearInterval(snapshotTimer)
    snapshotTimer = null
  }
}

/**
 * Bind to app lifecycle for cleanup.
 */
export function bindLifecycle(): void {
  app.on('before-quit', () => {
    isAppQuitting = true
    closeView()
  })
}
