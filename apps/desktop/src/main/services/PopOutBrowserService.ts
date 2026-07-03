/**
 * PopOutBrowserService — Independent browser window with address bar.
 *
 * Creates a BrowserWindow that loads a "browser shell" HTML page containing:
 *   - A toolbar with address bar, back/forward/refresh buttons
 *   - A <webview> below for actual page rendering
 *
 * The shell UI uses the same dark theme as the main application.
 */

import { app, BrowserWindow } from 'electron'
import { createLogger } from '@spark/shared'

const log = createLogger('popout-browser')

const DEFAULT_URL = 'https://spark.yiqibyte.com'

let popOutWindow: BrowserWindow | null = null
/** Set to true once `app` starts quitting — used to bypass the hide-on-close
 *  behavior so the window can be destroyed and the app can actually exit. */
let isAppQuitting = false

/** Browser shell HTML — themed to match the main application */
const SHELL_HTML = `data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Spark Agent · Browser</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body {
      display: flex; flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: #303030; color: #e0e0e0;
    }
    .toolbar {
      display: flex; align-items: center; gap: 4px;
      padding: 6px 8px;
      background: #262626;
      border-bottom: 1px solid #3a3a3a;
      -webkit-app-region: drag;
    }
    .toolbar button {
      -webkit-app-region: no-drag;
      background: transparent; border: none; border-radius: 5px;
      color: #8888a0; cursor: pointer; padding: 4px 6px; font-size: 15px;
      display: flex; align-items: center; justify-content: center;
      min-width: 30px; height: 28px; line-height: 1;
      transition: background 100ms, color 100ms;
    }
    .toolbar button:hover { background: #3a3a3a; color: #c0c0d0; }
    .toolbar button:active { background: #4a4a4a; color: #fff; }
    .urlbar-wrap {
      -webkit-app-region: no-drag;
      flex: 1; display: flex; align-items: center;
      background: #333333; border: 1px solid #3a3a3a; border-radius: 6px;
      padding: 0 8px; height: 30px; min-width: 0;
      transition: border-color 150ms;
    }
    .urlbar-wrap:focus-within { border-color: #6366f1; }
    .urlbar-icon { color: #555568; font-size: 12px; margin-right: 6px; flex-shrink: 0; }
    .urlbar {
      flex: 1; border: none; background: transparent; color: #d0d0e0;
      font-size: 13px; outline: none; min-width: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    }
    .urlbar::placeholder { color: #555568; }
    .urlbar:focus { color: #fff; }
    .go-btn {
      -webkit-app-region: no-drag;
      background: #6366f1; border: none; border-radius: 5px;
      color: #fff; cursor: pointer; padding: 0 12px; height: 30px; font-size: 12px; font-weight: 500;
      display: flex; align-items: center; justify-content: center;
      transition: background 100ms;
    }
    .go-btn:hover { background: #4f46e5; }
    .go-btn:active { background: #4338ca; }
    webview { flex: 1; border: none; display: block; background: #fff; }
    .status {
      padding: 3px 10px; font-size: 11px; color: #555568;
      background: #262626; border-top: 1px solid #3a3a3a;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      height: 22px; display: flex; align-items: center;
    }
    .loading-bar {
      height: 2px; background: #6366f1; position: relative; overflow: hidden;
    }
    .loading-bar::after {
      content: ''; position: absolute; top: 0; left: -40%; width: 40%; height: 100%;
      background: linear-gradient(90deg, transparent, #818cf8, transparent);
      animation: slide 1s ease-in-out infinite;
    }
    @keyframes slide { to { left: 100%; } }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button onclick="goBack()" title="后退">&#x2190;</button>
    <button onclick="goForward()" title="前进">&#x2192;</button>
    <button onclick="doReload()" title="刷新">&#x21BB;</button>
    <div class="urlbar-wrap">
      <span class="urlbar-icon">&#x1F310;</span>
      <input type="text" class="urlbar" id="urlbar" placeholder="输入网址..."
             onkeydown="if(event.key==='Enter'){event.preventDefault();navigate();}" />
    </div>
    <button class="go-btn" onclick="navigate()">前往</button>
  </div>
  <div class="loading-bar hidden" id="loading"></div>
  <webview id="browser" partition="persist:browser-automation" allowpopups="false"></webview>
  <div class="status" id="status"></div>
  <script>
    const wv = document.getElementById('browser');
    const urlbar = document.getElementById('urlbar');
    const statusEl = document.getElementById('status');
    const loadingEl = document.getElementById('loading');

    function navigate() {
      let url = urlbar.value.trim();
      if (!url) return;
      if (!/^[a-z][a-z0-9+.-]*:\\/\\//i.test(url)) {
        if (/^[\\w.-]+\\.[a-z]{2,}/i.test(url)) url = 'https://' + url;
        else url = 'https://' + url;
      }
      wv.loadURL(url);
    }
    function goBack() { if (wv.canGoBack()) wv.goBack(); }
    function goForward() { if (wv.canGoForward()) wv.goForward(); }
    function doReload() { wv.reload(); }

    wv.addEventListener('did-navigate', (e) => { urlbar.value = e.url; statusEl.textContent = ''; });
    wv.addEventListener('did-navigate-in-page', (e) => { urlbar.value = e.url; });
    wv.addEventListener('page-title-updated', (e) => { document.title = e.title + ' — Spark Agent'; });
    wv.addEventListener('did-start-loading', () => { loadingEl.classList.remove('hidden'); statusEl.textContent = '加载中...'; });
    wv.addEventListener('did-stop-loading', () => { loadingEl.classList.add('hidden'); statusEl.textContent = ''; });
    wv.addEventListener('did-fail-load', (e) => { loadingEl.classList.add('hidden'); if (e.errorCode !== -3) statusEl.textContent = '加载失败: ' + e.errorDescription; });

    window._loadURL = (url) => { wv.loadURL(url); };
    window._getURL = () => wv.getURL();
  </script>
</body>
</html>
`)}`

export async function openPopOutWindow(opts: { url?: string }): Promise<void> {
  if (popOutWindow != null && !popOutWindow.isDestroyed()) {
    popOutWindow.show()
    popOutWindow.focus()
    if (opts.url != null) {
      try {
        await popOutWindow.webContents.executeJavaScript(
          `window._loadURL && window._loadURL(${JSON.stringify(opts.url)})`,
        )
      } catch {
        // ignore
      }
    }
    return
  }

  log.info('Opening pop-out browser window')
  popOutWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Spark Agent · Browser',
    backgroundColor: '#303030',
    autoHideMenuBar: true,
    webPreferences: {
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  popOutWindow.on('close', (event) => {
    // If the app is quitting, allow the window to be destroyed. Otherwise the
    // user clicked the X button — hide instead of close so the window state
    // is preserved for the next open.
    if (isAppQuitting) {
      log.info('Pop-out browser window closing (app quitting)')
      return
    }
    event.preventDefault()
    popOutWindow?.hide()
    log.info('Pop-out browser window hidden (user closed)')
  })

  await popOutWindow.loadURL(SHELL_HTML)

  const targetUrl = opts.url ?? DEFAULT_URL
  await new Promise((r) => setTimeout(r, 200))
  try {
    await popOutWindow.webContents.executeJavaScript(
      `window._loadURL && window._loadURL(${JSON.stringify(targetUrl)})`,
    )
  } catch {
    // ignore
  }
}

export function closePopOutWindow(): void {
  if (popOutWindow != null && !popOutWindow.isDestroyed()) {
    popOutWindow.removeAllListeners('close')
    popOutWindow.destroy()
  }
  popOutWindow = null
}

export function isPopOutOpen(): boolean {
  return popOutWindow != null && !popOutWindow.isDestroyed() && popOutWindow.isVisible()
}

/**
 * Bind to app lifecycle for cleanup on quit.
 *
 * The close handler above hides the window instead of destroying it (so the
 * next `openPopOutWindow` can reuse the existing session). But on quit we
 * must actually destroy it — otherwise the hidden window keeps the Electron
 * event loop alive and `window-all-closed` never fires, so the process
 * cannot exit.
 *
 * Pair with `closePopOutWindow()` so the IPC pop-in path also stays healthy.
 */
export function bindLifecycle(): void {
  app.on('before-quit', () => {
    isAppQuitting = true
    closePopOutWindow()
  })
}
