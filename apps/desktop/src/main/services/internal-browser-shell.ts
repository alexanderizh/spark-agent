/**
 * The local chrome rendered by the visible spark_browser window.
 *
 * The web page itself stays in an Electron <webview>. This keeps the browser
 * controls separate from arbitrary remote content while preserving the
 * existing BrowserWindow-based automation surface in the main process.
 */

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function buildInternalBrowserShellUrl(partition: string): string {
  const safePartition = escapeHtmlAttribute(partition)
  const html = `
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="dark light">
  <title>SparkWork Browser</title>
  <style>
    :root {
      color-scheme: dark;
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: #171717;
      color: #f4f4f5;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { display: flex; flex-direction: column; background: #171717; }
    #toolbar {
      display: flex;
      align-items: center;
      gap: 7px;
      min-height: 52px;
      padding: 8px 12px;
      border-bottom: 1px solid #303030;
      background: #202020;
    }
    #navigation { display: flex; align-items: center; gap: 2px; }
    button {
      appearance: none;
      min-width: 30px;
      height: 30px;
      padding: 0 9px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: #d4d4d8;
      cursor: pointer;
      font: inherit;
    }
    button:hover:not(:disabled) { background: #343434; border-color: #454545; }
    button:active:not(:disabled) { background: #404040; }
    button:disabled { color: #666; cursor: default; }
    .nav-button { font-size: 21px; line-height: 1; }
    #reload { font-size: 19px; }
    #address-form { display: flex; flex: 1; min-width: 0; gap: 6px; }
    #address {
      flex: 1;
      min-width: 0;
      height: 30px;
      padding: 0 10px;
      border: 1px solid #444;
      border-radius: 6px;
      outline: none;
      background: #171717;
      color: #f4f4f5;
      font: inherit;
    }
    #address:focus { border-color: #6b8afd; box-shadow: 0 0 0 2px rgba(107, 138, 253, .2); }
    #open { background: #4f6fdf; color: #fff; }
    #open:hover { background: #5d7cf0; }
    #viewport { flex: 1; min-height: 0; background: #fff; }
    #page { width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  <div id="toolbar" role="toolbar" aria-label="浏览器工具栏">
    <div id="navigation">
      <button id="back" class="nav-button" type="button" title="后退" aria-label="后退" disabled>‹</button>
      <button id="forward" class="nav-button" type="button" title="前进" aria-label="前进" disabled>›</button>
      <button id="reload" type="button" title="刷新" aria-label="刷新">↻</button>
    </div>
    <form id="address-form" role="search">
      <input id="address" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="输入网址…" aria-label="地址栏">
      <button id="open" type="submit">打开</button>
    </form>
  </div>
  <div id="viewport">
    <webview id="page" src="about:blank" partition="${safePartition}"></webview>
  </div>
  <script>
    const page = document.getElementById('page')
    const address = document.getElementById('address')
    const back = document.getElementById('back')
    const forward = document.getElementById('forward')
    const reload = document.getElementById('reload')
    const addressForm = document.getElementById('address-form')

    function normalizeUrl(raw) {
      const value = raw.trim()
      if (!value) return ''
      if (/^(https?|file|data):/i.test(value)) return value
      return 'https://' + value
    }

    function currentUrl() {
      try { return page.getURL() || '' } catch { return '' }
    }

    function syncToolbar() {
      const url = currentUrl()
      if (document.activeElement !== address) address.value = url === 'about:blank' ? '' : url
      try {
        back.disabled = !page.canGoBack()
        forward.disabled = !page.canGoForward()
      } catch {
        back.disabled = true
        forward.disabled = true
      }
    }

    function navigate(raw) {
      const url = normalizeUrl(raw)
      if (url) void page.loadURL(url).catch(() => {})
    }

    back.addEventListener('click', () => { if (!back.disabled) page.goBack() })
    forward.addEventListener('click', () => { if (!forward.disabled) page.goForward() })
    reload.addEventListener('click', () => {
      try { page.reload() } catch {}
    })
    addressForm.addEventListener('submit', (event) => {
      event.preventDefault()
      navigate(address.value)
    })
    address.addEventListener('focus', () => address.select())

    for (const eventName of ['did-navigate', 'did-navigate-in-page', 'dom-ready', 'did-stop-loading', 'did-fail-load']) {
      page.addEventListener(eventName, syncToolbar)
    }
    syncToolbar()
  </script>
</body>
</html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}
