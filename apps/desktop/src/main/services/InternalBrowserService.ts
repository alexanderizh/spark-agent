import { app, BrowserWindow, session as electronSession } from 'electron'
import { randomUUID } from 'node:crypto'
import { createLogger } from '@spark/shared'

const log = createLogger('internal-browser')

const DEFAULT_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>SparkWork Browser</title>
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      display: grid;
      place-items: center;
      background: #171717;
      color: #f4f4f5;
      font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
    main { max-width: 520px; padding: 40px; line-height: 1.6; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    p { margin: 0; color: #a1a1aa; }
  </style>
</head>
<body>
  <main>
    <h1>SparkWork Browser</h1>
    <p>Visible browser window controlled by the built-in spark_browser MCP tools.</p>
  </main>
</body>
</html>
`)

const PROFILE_ID_RE = /^[a-zA-Z0-9_.-]{1,80}$/
const MAX_EVENTS = 500

export type InternalBrowserErrorCode =
  | 'WINDOW_NOT_FOUND'
  | 'NAVIGATION_FAILED'
  | 'EVAL_FAILED'
  | 'SCRIPT_INJECTION_FAILED'
  | 'NETWORK_RULE_UNSUPPORTED'
  | 'PROFILE_INVALID'

export class InternalBrowserError extends Error {
  constructor(
    readonly code: InternalBrowserErrorCode,
    message: string,
    readonly context: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'InternalBrowserError'
  }
}

type ConsoleEvent = {
  seq: number
  level: string
  message: string
  sourceId?: string
  line?: number
  ts: number
}

type NetworkEvent = {
  seq: number
  kind: 'request' | 'completed' | 'error' | 'blocked' | 'redirected'
  method?: string
  url: string
  statusCode?: number
  error?: string
  ruleId?: string
  ts: number
}

type NetworkRule = {
  id: string
  match: string
  action: 'record' | 'block' | 'redirect' | 'set_headers' | 'mock_response'
  redirectUrl?: string
  headers?: Record<string, string>
}

type InjectedScript = {
  scriptId: string
  code: string
  createdAt: string
}

type WindowState = {
  windowId: string
  profileId: string
  partition: string
  win: BrowserWindow
  createdAt: string
  lastActiveAt: string
  url: string | null
  title: string | null
  injectedScripts: Map<string, InjectedScript>
  consoleCapture: boolean
  consoleEvents: ConsoleEvent[]
  consoleSeq: number
  networkEvents: NetworkEvent[]
  networkSeq: number
  networkRules: Map<string, NetworkRule>
}

export type InternalBrowserMeta = {
  windowId: string
  profileId: string
  visible: boolean
  url: string | null
  title: string | null
  injectedScriptCount: number
  networkRuleCount: number
  consoleEventCount: number
}

function validateProfileId(profileId: string | undefined): string {
  const value = (profileId ?? 'default').trim() || 'default'
  if (!PROFILE_ID_RE.test(value)) {
    throw new InternalBrowserError('PROFILE_INVALID', 'Invalid browser profileId', { profileId })
  }
  return value
}

function partitionForProfile(profileId: string): string {
  return `persist:spark-browser:${profileId}`
}

function pushBounded<T>(items: T[], item: T): void {
  items.push(item)
  if (items.length > MAX_EVENTS) items.splice(0, items.length - MAX_EVENTS)
}

function normalizeUrl(url: string | undefined): string {
  const value = (url ?? DEFAULT_URL).trim()
  if (!value) return DEFAULT_URL
  if (/^(https?|file|data):/i.test(value)) return value
  return `https://${value}`
}

function matchesRule(rule: NetworkRule, url: string): boolean {
  if (!rule.match) return false
  if (url.includes(rule.match)) return true
  try {
    return new RegExp(rule.match).test(url)
  } catch {
    return false
  }
}

export class InternalBrowserService {
  private readonly windows = new Map<string, WindowState>()
  private lifecycleBound = false

  bindLifecycle(): void {
    if (this.lifecycleBound) return
    this.lifecycleBound = true
    app.on('before-quit', () => {
      this.closeAll()
    })
  }

  async openWindow(opts: {
    url?: string
    show?: boolean
    profileId?: string
    reuse?: boolean
  } = {}): Promise<InternalBrowserMeta> {
    const profileId = validateProfileId(opts.profileId)
    const targetUrl = normalizeUrl(opts.url)
    const reused = opts.reuse === true
      ? [...this.windows.values()].find((state) => state.profileId === profileId && !state.win.isDestroyed())
      : undefined
    if (reused != null) {
      if (opts.show !== false) reused.win.show()
      await this.navigate(reused.windowId, targetUrl)
      return this.meta(reused)
    }

    const windowId = `browser-${randomUUID()}`
    const partition = partitionForProfile(profileId)
    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      title: 'SparkWork Browser',
      show: opts.show !== false,
      autoHideMenuBar: true,
      backgroundColor: '#171717',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    const now = new Date().toISOString()
    const state: WindowState = {
      windowId,
      profileId,
      partition,
      win,
      createdAt: now,
      lastActiveAt: now,
      url: null,
      title: null,
      injectedScripts: new Map(),
      consoleCapture: false,
      consoleEvents: [],
      consoleSeq: 0,
      networkEvents: [],
      networkSeq: 0,
      networkRules: new Map(),
    }
    this.windows.set(windowId, state)
    this.attachWindowEvents(state)
    this.installNetworkHooks(state)
    await this.navigate(windowId, targetUrl)
    return this.meta(state)
  }

  async navigate(windowId: string | undefined, url: string): Promise<{ url: string | null; title: string | null }> {
    const state = this.requireWindow(windowId)
    const targetUrl = normalizeUrl(url)
    try {
      await state.win.loadURL(targetUrl)
      state.url = state.win.webContents.getURL() || targetUrl
      state.title = state.win.getTitle() || null
      state.lastActiveAt = new Date().toISOString()
      await this.runInjectedScripts(state)
      return { url: state.url, title: state.title }
    } catch (err) {
      throw new InternalBrowserError('NAVIGATION_FAILED', err instanceof Error ? err.message : String(err), {
        windowId: state.windowId,
        url: targetUrl,
      })
    }
  }

  async evalJs(windowId: string | undefined, code: string): Promise<unknown> {
    const state = this.requireWindow(windowId)
    try {
      state.lastActiveAt = new Date().toISOString()
      return await state.win.webContents.executeJavaScript(code, true)
    } catch (err) {
      throw new InternalBrowserError('EVAL_FAILED', err instanceof Error ? err.message : String(err), {
        windowId: state.windowId,
      })
    }
  }

  async injectScript(windowId: string | undefined, code: string, scriptId?: string): Promise<{ scriptId: string }> {
    const state = this.requireWindow(windowId)
    const id = scriptId?.trim() || `script-${randomUUID()}`
    state.injectedScripts.set(id, { scriptId: id, code, createdAt: new Date().toISOString() })
    try {
      await state.win.webContents.executeJavaScript(code, true)
      return { scriptId: id }
    } catch (err) {
      state.injectedScripts.delete(id)
      throw new InternalBrowserError('SCRIPT_INJECTION_FAILED', err instanceof Error ? err.message : String(err), {
        windowId: state.windowId,
        scriptId: id,
      })
    }
  }

  removeScript(windowId: string | undefined, scriptId: string): { ok: true } {
    const state = this.requireWindow(windowId)
    state.injectedScripts.delete(scriptId)
    return { ok: true }
  }

  async screenshot(windowId: string | undefined): Promise<{ dataUrl: string; url: string | null; title: string | null }> {
    const state = this.requireWindow(windowId)
    const image = await state.win.webContents.capturePage()
    return { dataUrl: image.toDataURL(), url: state.url ?? state.win.webContents.getURL() ?? null, title: state.title ?? state.win.getTitle() ?? null }
  }

  getUrl(windowId: string | undefined): { url: string | null } {
    const state = this.requireWindow(windowId)
    return { url: state.win.webContents.getURL() || state.url }
  }

  getTitle(windowId: string | undefined): { title: string | null } {
    const state = this.requireWindow(windowId)
    return { title: state.win.getTitle() || state.title }
  }

  listWindows(): InternalBrowserMeta[] {
    return [...this.windows.values()]
      .filter((state) => !state.win.isDestroyed())
      .map((state) => this.meta(state))
  }

  closeWindow(windowId: string | undefined): { ok: true } {
    const state = this.requireWindow(windowId)
    this.destroyState(state)
    return { ok: true }
  }

  closeAll(): void {
    for (const state of [...this.windows.values()]) this.destroyState(state)
  }

  startConsoleCapture(windowId: string | undefined): { ok: true } {
    const state = this.requireWindow(windowId)
    state.consoleCapture = true
    return { ok: true }
  }

  getConsoleEvents(windowId: string | undefined, sinceSeq?: number): { events: ConsoleEvent[] } {
    const state = this.requireWindow(windowId)
    const min = Number.isFinite(sinceSeq) ? Number(sinceSeq) : 0
    return { events: state.consoleEvents.filter((event) => event.seq > min) }
  }

  clearConsoleEvents(windowId: string | undefined): { ok: true } {
    const state = this.requireWindow(windowId)
    state.consoleEvents = []
    return { ok: true }
  }

  setNetworkRules(windowId: string | undefined, rules: Array<Partial<NetworkRule>>): { ruleIds: string[] } {
    const state = this.requireWindow(windowId)
    const ruleIds: string[] = []
    for (const raw of rules) {
      const action = raw.action
      if (action === 'mock_response') {
        throw new InternalBrowserError(
          'NETWORK_RULE_UNSUPPORTED',
          'mock_response requires response-body interception and is not enabled in this build',
          { windowId: state.windowId },
        )
      }
      if (action !== 'record' && action !== 'block' && action !== 'redirect' && action !== 'set_headers') continue
      const id = raw.id ?? `rule-${randomUUID()}`
      state.networkRules.set(id, {
        id,
        match: String(raw.match ?? ''),
        action,
        ...(typeof raw.redirectUrl === 'string' ? { redirectUrl: raw.redirectUrl } : {}),
        ...(raw.headers != null && typeof raw.headers === 'object' ? { headers: raw.headers as Record<string, string> } : {}),
      })
      ruleIds.push(id)
    }
    return { ruleIds }
  }

  getNetworkEvents(windowId: string | undefined, sinceSeq?: number): { events: NetworkEvent[] } {
    const state = this.requireWindow(windowId)
    const min = Number.isFinite(sinceSeq) ? Number(sinceSeq) : 0
    return { events: state.networkEvents.filter((event) => event.seq > min) }
  }

  clearNetwork(windowId: string | undefined, ruleIds?: string[]): { ok: true } {
    const state = this.requireWindow(windowId)
    if (Array.isArray(ruleIds) && ruleIds.length > 0) {
      for (const id of ruleIds) state.networkRules.delete(id)
    } else {
      state.networkRules.clear()
      state.networkEvents = []
    }
    return { ok: true }
  }

  async clearProfile(profileIdInput: string, scope: string[] = ['all']): Promise<{ ok: true; profileId: string }> {
    const profileId = validateProfileId(profileIdInput)
    const ses = electronSession.fromPartition(partitionForProfile(profileId))
    const all = scope.includes('all')
    if (all || scope.includes('cache')) await ses.clearCache()
    if (all || scope.includes('cookies')) await ses.clearStorageData({ storages: ['cookies'] })
    if (all || scope.some((item) => item === 'localStorage' || item === 'indexedDB')) {
      await ses.clearStorageData({
        storages: [
          ...(all || scope.includes('localStorage') ? ['localstorage' as const] : []),
          ...(all || scope.includes('indexedDB') ? ['indexdb' as const] : []),
        ],
      })
    }
    return { ok: true, profileId }
  }

  private attachWindowEvents(state: WindowState): void {
    state.win.webContents.setWindowOpenHandler(({ url }) => {
      void this.navigate(state.windowId, url).catch((err) => log.warn(`windowOpen navigate failed: ${String(err)}`))
      return { action: 'deny' }
    })
    state.win.webContents.on('did-navigate', (_event, url) => {
      state.url = url
      state.lastActiveAt = new Date().toISOString()
    })
    state.win.webContents.on('did-navigate-in-page', (_event, url) => {
      state.url = url
      state.lastActiveAt = new Date().toISOString()
    })
    state.win.webContents.on('page-title-updated', (_event, title) => {
      state.title = title
      state.lastActiveAt = new Date().toISOString()
    })
    state.win.webContents.on('dom-ready', () => {
      void this.runInjectedScripts(state)
    })
    state.win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (!state.consoleCapture) return
      pushBounded(state.consoleEvents, {
        seq: ++state.consoleSeq,
        level: String(level),
        message,
        sourceId,
        line,
        ts: Date.now(),
      })
    })
    state.win.on('closed', () => {
      this.windows.delete(state.windowId)
    })
  }

  private installNetworkHooks(state: WindowState): void {
    const filter = { urls: ['*://*/*', 'file://*/*', 'data:*'] }
    const ses = state.win.webContents.session
    ses.webRequest.onBeforeRequest(filter, (details, callback) => {
      if (details.webContentsId !== state.win.webContents.id) return callback({})
      const rule = [...state.networkRules.values()].find((candidate) => matchesRule(candidate, details.url))
      pushBounded(state.networkEvents, {
        seq: ++state.networkSeq,
        kind: rule?.action === 'block' ? 'blocked' : rule?.action === 'redirect' ? 'redirected' : 'request',
        method: details.method,
        url: details.url,
        ...(rule?.id != null ? { ruleId: rule.id } : {}),
        ts: Date.now(),
      })
      if (rule?.action === 'block') return callback({ cancel: true })
      if (rule?.action === 'redirect' && rule.redirectUrl) return callback({ redirectURL: rule.redirectUrl })
      callback({})
    })
    ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      if (details.webContentsId !== state.win.webContents.id) return callback({ requestHeaders: details.requestHeaders })
      const headerRules = [...state.networkRules.values()]
        .filter((rule) => rule.action === 'set_headers' && matchesRule(rule, details.url) && rule.headers != null)
      if (headerRules.length === 0) return callback({ requestHeaders: details.requestHeaders })
      const requestHeaders = { ...details.requestHeaders }
      for (const rule of headerRules) Object.assign(requestHeaders, rule.headers)
      callback({ requestHeaders })
    })
    ses.webRequest.onCompleted(filter, (details) => {
      if (details.webContentsId !== state.win.webContents.id) return
      pushBounded(state.networkEvents, {
        seq: ++state.networkSeq,
        kind: 'completed',
        method: details.method,
        url: details.url,
        statusCode: details.statusCode,
        ts: Date.now(),
      })
    })
    ses.webRequest.onErrorOccurred(filter, (details) => {
      if (details.webContentsId !== state.win.webContents.id) return
      pushBounded(state.networkEvents, {
        seq: ++state.networkSeq,
        kind: 'error',
        method: details.method,
        url: details.url,
        error: details.error,
        ts: Date.now(),
      })
    })
  }

  private async runInjectedScripts(state: WindowState): Promise<void> {
    for (const script of state.injectedScripts.values()) {
      try {
        await state.win.webContents.executeJavaScript(script.code, true)
      } catch (err) {
        log.warn(`Persistent script failed windowId=${state.windowId} scriptId=${script.scriptId}: ${String(err)}`)
      }
    }
  }

  private requireWindow(windowId: string | undefined): WindowState {
    const target = windowId == null || windowId.trim() === ''
      ? [...this.windows.values()].find((state) => !state.win.isDestroyed())
      : this.windows.get(windowId)
    if (target == null || target.win.isDestroyed()) {
      throw new InternalBrowserError('WINDOW_NOT_FOUND', 'Browser window not found', { windowId })
    }
    return target
  }

  private meta(state: WindowState): InternalBrowserMeta {
    return {
      windowId: state.windowId,
      profileId: state.profileId,
      visible: state.win.isVisible(),
      url: state.win.webContents.getURL() || state.url,
      title: state.win.getTitle() || state.title,
      injectedScriptCount: state.injectedScripts.size,
      networkRuleCount: state.networkRules.size,
      consoleEventCount: state.consoleEvents.length,
    }
  }

  private destroyState(state: WindowState): void {
    state.injectedScripts.clear()
    state.networkRules.clear()
    state.consoleEvents = []
    state.networkEvents = []
    this.windows.delete(state.windowId)
    if (!state.win.isDestroyed()) {
      state.win.removeAllListeners('closed')
      state.win.destroy()
    }
  }
}

let singleton: InternalBrowserService | null = null

export function getInternalBrowserService(): InternalBrowserService {
  if (singleton == null) singleton = new InternalBrowserService()
  return singleton
}
