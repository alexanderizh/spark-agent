import { app, BrowserWindow, session as electronSession } from 'electron'
import type { Cookie, DownloadItem, Event, Session, WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { createLogger } from '@spark/shared'
import { buildInternalBrowserShellUrl } from './internal-browser-shell.js'

const log = createLogger('internal-browser')

const DEFAULT_URL =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`
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
const SPARK_BROWSER_PARTITION_PREFIX = 'persist:spark-browser:'
// Chromium persist partitions only store cookies that carry an expiration
// date. Session cookies (no expirationDate) — common for QR-code logins —
// would be dropped on every app restart. The cookie bridge mirrors them into
// persistent cookies capped at this lifetime (same tradeoff as Chrome's
// "continue where you left off").
const SESSION_COOKIE_PERSIST_SECONDS = 90 * 24 * 60 * 60
const MAX_EVENTS = 500
const DOWNLOAD_TIMEOUT_MS = 120_000
const MEDIA_INSPECTION_SCRIPT = `(() => {
  const candidates = []
  const seen = new Set()
  const add = (value, source, visible, width, height) => {
    if (typeof value !== 'string' || !/^https?:\\/\\//i.test(value) || seen.has(value)) return
    seen.add(value)
    candidates.push({ value, source, visible, width, height })
  }
  const describe = (element, source) => {
    const rect = element.getBoundingClientRect()
    const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
    add(element.currentSrc || element.src || '', source, visible, Math.round(rect.width), Math.round(rect.height))
  }
  document.querySelectorAll('video').forEach((video) => {
    describe(video, 'video')
    video.querySelectorAll('source').forEach((source) => add(source.src || source.getAttribute('src') || '', 'source', true, 0, 0))
  })
  document.querySelectorAll('video source, source').forEach((source) => {
    add(source.src || source.getAttribute('src') || '', 'source', true, 0, 0)
  })
  const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || ''
  return { pageUrl: location.href, title, candidates }
})()`

export type InternalBrowserErrorCode =
  | 'WINDOW_NOT_FOUND'
  | 'NAVIGATION_FAILED'
  | 'EVAL_FAILED'
  | 'SCRIPT_INJECTION_FAILED'
  | 'NETWORK_RULE_UNSUPPORTED'
  | 'PROFILE_INVALID'
  | 'MEDIA_NOT_FOUND'
  | 'INVALID_MEDIA_URL'
  | 'DOWNLOAD_FAILED'

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
  resourceType?: string
  mimeType?: string
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
  pageWebContents: WebContents | null
  pageReady: Promise<WebContents>
  resolvePageReady: ((contents: WebContents) => void) | null
  networkHooksInstalled: boolean
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
  mediaCandidates: Map<string, InternalBrowserMediaCandidate['kind']>
}

export type InternalBrowserMediaCandidate = {
  url: string
  source: 'video' | 'source' | 'network'
  kind: 'mp4' | 'hls' | 'dash' | 'unknown'
  visible?: boolean
  width?: number
  height?: number
}

export type InternalBrowserMediaInspection = {
  pageUrl: string | null
  title: string | null
  candidates: InternalBrowserMediaCandidate[]
}

export type InternalBrowserDownloadResult = {
  path: string
  filename: string
  size: number
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
  return `${SPARK_BROWSER_PARTITION_PREFIX}${profileId}`
}

/**
 * Copy a session cookie (no expirationDate) into an equivalent persistent
 * cookie so the login survives app restarts. `cookies.set` overwrites the
 * existing (name, domain, path) entry, so this upgrades the cookie in place.
 */
async function persistSessionCookie(ses: Session, cookie: Cookie): Promise<void> {
  const domain = cookie.domain ?? ''
  const host = domain.replace(/^\./, '')
  if (!host || cookie.path == null || !cookie.name) return
  const scheme = cookie.secure === true ? 'https' : 'http'
  await ses.cookies.set({
    url: `${scheme}://${host}${cookie.path}`,
    name: cookie.name,
    value: cookie.value ?? '',
    // Forward domain only for wildcard cookies (leading dot); omitting it
    // keeps host-only cookies host-only.
    ...(domain.startsWith('.') ? { domain } : {}),
    path: cookie.path,
    ...(cookie.secure === true ? { secure: true } : {}),
    ...(cookie.httpOnly === true ? { httpOnly: true } : {}),
    expirationDate: Math.floor(Date.now() / 1000) + SESSION_COOKIE_PERSIST_SECONDS,
    ...(cookie.sameSite != null && cookie.sameSite !== 'unspecified'
      ? { sameSite: cookie.sameSite }
      : {}),
  })
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

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function mediaKind(url: string, mimeType?: string): InternalBrowserMediaCandidate['kind'] {
  const lower = url.toLowerCase()
  const mime = mimeType?.toLowerCase() ?? ''
  if (
    /\.mp4(?:[?#]|$)/.test(lower) ||
    lower.includes('mime_type=video_mp4') ||
    mime.startsWith('video/mp4')
  )
    return 'mp4'
  if (/\.m3u8(?:[?#]|$)/.test(lower) || mime.includes('mpegurl') || mime.includes('x-mpegurl'))
    return 'hls'
  if (/\.mpd(?:[?#]|$)/.test(lower) || mime.includes('dash+xml')) return 'dash'
  return 'unknown'
}

function isLikelyMediaUrl(url: string, resourceType?: string, mimeType?: string): boolean {
  const lower = url.toLowerCase()
  const mime = mimeType?.toLowerCase() ?? ''
  return (
    resourceType === 'media' ||
    mime.startsWith('video/') ||
    mime.includes('mpegurl') ||
    mime.includes('x-mpegurl') ||
    mime.includes('dash+xml') ||
    /\.(mp4|m3u8|mpd)(?:[?#]|$)/.test(lower) ||
    lower.includes('mime_type=video') ||
    lower.includes('douyinvod.com/') ||
    lower.includes('/videoplayback')
  )
}

function sanitizeDownloadFilename(
  input: string | undefined,
  mediaUrl: string,
  kindOverride?: InternalBrowserMediaCandidate['kind'],
): string {
  const fallback = `video-${Date.now()}`
  const raw = input?.trim() || fallback
  const safeRaw = [...raw]
    .map((character) =>
      character.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(character) ? '_' : character,
    )
    .join('')
  const base = path.basename(safeRaw).slice(0, 160) || fallback
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base
  const extension = (kindOverride ?? mediaKind(mediaUrl)) === 'mp4' ? '.mp4' : '.bin'
  return `${base}${extension}`
}

function extractMimeType(headers: Record<string, string[]> | undefined): string | undefined {
  if (headers == null) return undefined
  const raw = headers['content-type'] ?? headers['Content-Type']
  const value = raw?.[0]?.split(';', 1)[0]?.trim()
  return value || undefined
}

function createPageReady(): {
  promise: Promise<WebContents>
  resolve: (contents: WebContents) => void
} {
  let resolve!: (contents: WebContents) => void
  const promise = new Promise<WebContents>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

export class InternalBrowserService {
  private readonly windows = new Map<string, WindowState>()
  private readonly cookieBridgePartitions = new Set<string>()
  private lifecycleBound = false

  bindLifecycle(): void {
    if (this.lifecycleBound) return
    this.lifecycleBound = true
    // The shared default partition is also mounted by the sidebar webview,
    // which never passes through openWindow — install its cookie bridge
    // eagerly so sidebar logins persist too.
    this.installSessionCookieBridge(partitionForProfile('default'))
    app.on('before-quit', () => {
      this.closeAll()
    })
  }

  async openWindow(
    opts: {
      url?: string
      show?: boolean
      profileId?: string
      reuse?: boolean
    } = {},
  ): Promise<InternalBrowserMeta> {
    const profileId = validateProfileId(opts.profileId)
    const targetUrl = normalizeUrl(opts.url)
    const reused =
      opts.reuse === true
        ? [...this.windows.values()].find(
            (state) => state.profileId === profileId && !state.win.isDestroyed(),
          )
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
        webviewTag: true,
      },
    })
    const now = new Date().toISOString()
    const pageReady = createPageReady()
    const state: WindowState = {
      windowId,
      profileId,
      partition,
      win,
      pageWebContents: null,
      pageReady: pageReady.promise,
      resolvePageReady: pageReady.resolve,
      networkHooksInstalled: false,
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
      mediaCandidates: new Map(),
    }
    this.windows.set(windowId, state)
    this.installSessionCookieBridge(partition)
    this.attachWindowEvents(state)
    await win.loadURL(buildInternalBrowserShellUrl(partition))
    await this.navigate(windowId, targetUrl)
    return this.meta(state)
  }

  async navigate(
    windowId: string | undefined,
    url: string,
  ): Promise<{ url: string | null; title: string | null }> {
    const state = this.requireWindow(windowId)
    const targetUrl = normalizeUrl(url)
    this.clearMediaState(state)
    try {
      const page = await this.getPageWebContents(state)
      await page.loadURL(targetUrl)
      state.url = page.getURL() || targetUrl
      state.title = page.getTitle() || null
      state.lastActiveAt = new Date().toISOString()
      await this.runInjectedScripts(state)
      return { url: state.url, title: state.title }
    } catch (err) {
      throw new InternalBrowserError(
        'NAVIGATION_FAILED',
        err instanceof Error ? err.message : String(err),
        {
          windowId: state.windowId,
          url: targetUrl,
        },
      )
    }
  }

  async evalJs(windowId: string | undefined, code: string): Promise<unknown> {
    const state = this.requireWindow(windowId)
    try {
      const page = await this.getPageWebContents(state)
      state.lastActiveAt = new Date().toISOString()
      return await page.executeJavaScript(code, true)
    } catch (err) {
      throw new InternalBrowserError(
        'EVAL_FAILED',
        err instanceof Error ? err.message : String(err),
        {
          windowId: state.windowId,
        },
      )
    }
  }

  async inspectMedia(windowId: string | undefined): Promise<InternalBrowserMediaInspection> {
    const state = this.requireWindow(windowId)
    const page = await this.getPageWebContents(state)
    let domResult: {
      pageUrl?: unknown
      title?: unknown
      candidates?: unknown
    }
    try {
      domResult = (await page.executeJavaScript(MEDIA_INSPECTION_SCRIPT, true)) as typeof domResult
    } catch (err) {
      throw new InternalBrowserError(
        'EVAL_FAILED',
        err instanceof Error ? err.message : String(err),
        {
          windowId: state.windowId,
        },
      )
    }

    const candidates: InternalBrowserMediaCandidate[] = []
    const seen = new Set<string>()
    const addCandidate = (
      value: unknown,
      source: InternalBrowserMediaCandidate['source'],
      metadata: Partial<InternalBrowserMediaCandidate> = {},
    ): void => {
      if (typeof value !== 'string' || !isHttpUrl(value)) return
      const kind = metadata.kind ?? mediaKind(value)
      if (seen.has(value)) {
        const existing = candidates.find((candidate) => candidate.url === value)
        if (existing != null && existing.kind === 'unknown' && kind !== 'unknown') {
          existing.kind = kind
          state.mediaCandidates.set(value, kind)
        }
        return
      }
      seen.add(value)
      state.mediaCandidates.set(value, kind)
      candidates.push({ url: value, source, ...metadata, kind })
    }

    if (Array.isArray(domResult?.candidates)) {
      for (const candidate of domResult.candidates) {
        if (candidate == null || typeof candidate !== 'object') continue
        const item = candidate as Record<string, unknown>
        const source = item.source === 'source' ? 'source' : 'video'
        addCandidate(item.value, source, {
          visible: item.visible === true,
          ...(typeof item.width === 'number' ? { width: item.width } : {}),
          ...(typeof item.height === 'number' ? { height: item.height } : {}),
        })
      }
    }

    for (const event of state.networkEvents) {
      if (event.kind !== 'request' && event.kind !== 'completed') continue
      if (!isLikelyMediaUrl(event.url, event.resourceType, event.mimeType)) continue
      addCandidate(event.url, 'network', { kind: mediaKind(event.url, event.mimeType) })
    }

    return {
      pageUrl: typeof domResult?.pageUrl === 'string' ? domResult.pageUrl : page.getURL() || null,
      title: typeof domResult?.title === 'string' ? domResult.title : page.getTitle() || null,
      candidates,
    }
  }

  async downloadMedia(
    windowId: string | undefined,
    mediaUrl: string,
    filename?: string,
  ): Promise<InternalBrowserDownloadResult> {
    const state = this.requireWindow(windowId)
    if (!isHttpUrl(mediaUrl)) {
      throw new InternalBrowserError('INVALID_MEDIA_URL', '媒体地址必须是 http(s) URL。', {
        windowId: state.windowId,
      })
    }
    if (!state.mediaCandidates.has(mediaUrl)) {
      throw new InternalBrowserError(
        'INVALID_MEDIA_URL',
        '媒体地址不是当前页面抓取到的播放资源。',
        {
          windowId: state.windowId,
        },
      )
    }

    const page = await this.getPageWebContents(state)
    const safeFilename = sanitizeDownloadFilename(
      filename,
      mediaUrl,
      state.mediaCandidates.get(mediaUrl),
    )
    const destination = path.join(app.getPath('downloads'), safeFilename)
    const downloadSession = page.session

    return await new Promise<InternalBrowserDownloadResult>((resolve, reject) => {
      let settled = false
      let downloadItem: DownloadItem | null = null

      const finish = (error?: Error, result?: InternalBrowserDownloadResult): void => {
        if (settled) return
        settled = true
        if (timeoutId != null) clearTimeout(timeoutId)
        downloadSession.removeListener('will-download', handleWillDownload)
        if (error != null) reject(error)
        else if (result != null) resolve(result)
        else reject(new Error('下载未返回结果'))
      }

      const handleWillDownload = (_event: Event, item: DownloadItem): void => {
        downloadItem = item
        item.setSavePath(destination)
        item.once('done', (_doneEvent, stateValue) => {
          if (stateValue !== 'completed') {
            finish(new Error(`浏览器下载未完成：${stateValue}`))
            return
          }
          finish(undefined, {
            path: item.getSavePath() || destination,
            filename: item.getFilename() || safeFilename,
            size: Math.max(item.getReceivedBytes(), 0),
          })
        })
      }

      downloadSession.once('will-download', handleWillDownload)
      const timeoutId = setTimeout(() => {
        if (downloadItem != null) downloadItem.cancel()
        finish(new Error('浏览器下载超时，请确认页面仍保持登录并可播放。'))
      }, DOWNLOAD_TIMEOUT_MS)

      try {
        const referer = page.getURL()
        const headers = referer ? { Referer: referer } : undefined
        page.downloadURL(mediaUrl, headers == null ? undefined : { headers })
      } catch (err) {
        finish(new Error(err instanceof Error ? err.message : String(err)))
      }
    }).catch((err) => {
      throw new InternalBrowserError(
        'DOWNLOAD_FAILED',
        err instanceof Error ? err.message : String(err),
        {
          windowId: state.windowId,
          url: mediaUrl,
        },
      )
    })
  }

  async injectScript(
    windowId: string | undefined,
    code: string,
    scriptId?: string,
  ): Promise<{ scriptId: string }> {
    const state = this.requireWindow(windowId)
    const id = scriptId?.trim() || `script-${randomUUID()}`
    state.injectedScripts.set(id, { scriptId: id, code, createdAt: new Date().toISOString() })
    try {
      const page = await this.getPageWebContents(state)
      await page.executeJavaScript(code, true)
      return { scriptId: id }
    } catch (err) {
      state.injectedScripts.delete(id)
      throw new InternalBrowserError(
        'SCRIPT_INJECTION_FAILED',
        err instanceof Error ? err.message : String(err),
        {
          windowId: state.windowId,
          scriptId: id,
        },
      )
    }
  }

  removeScript(windowId: string | undefined, scriptId: string): { ok: true } {
    const state = this.requireWindow(windowId)
    state.injectedScripts.delete(scriptId)
    return { ok: true }
  }

  async screenshot(
    windowId: string | undefined,
  ): Promise<{ dataUrl: string; url: string | null; title: string | null }> {
    const state = this.requireWindow(windowId)
    const page = await this.getPageWebContents(state)
    const image = await state.win.webContents.capturePage()
    return {
      dataUrl: image.toDataURL(),
      url: state.url ?? page.getURL() ?? null,
      title: state.title ?? page.getTitle() ?? null,
    }
  }

  getUrl(windowId: string | undefined): { url: string | null } {
    const state = this.requireWindow(windowId)
    return { url: state.pageWebContents?.getURL() || state.url }
  }

  getTitle(windowId: string | undefined): { title: string | null } {
    const state = this.requireWindow(windowId)
    return { title: state.pageWebContents?.getTitle() || state.title }
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

  setNetworkRules(
    windowId: string | undefined,
    rules: Array<Partial<NetworkRule>>,
  ): { ruleIds: string[] } {
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
      if (
        action !== 'record' &&
        action !== 'block' &&
        action !== 'redirect' &&
        action !== 'set_headers'
      )
        continue
      const id = raw.id ?? `rule-${randomUUID()}`
      state.networkRules.set(id, {
        id,
        match: String(raw.match ?? ''),
        action,
        ...(typeof raw.redirectUrl === 'string' ? { redirectUrl: raw.redirectUrl } : {}),
        ...(raw.headers != null && typeof raw.headers === 'object'
          ? { headers: raw.headers as Record<string, string> }
          : {}),
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

  async clearProfile(
    profileIdInput: string,
    scope: string[] = ['all'],
  ): Promise<{ ok: true; profileId: string }> {
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

  /**
   * Mirror session cookies written inside a spark-browser partition into
   * persistent cookies (see persistSessionCookie). Idempotent per partition;
   * the listener lives on the long-lived partition session, so it also covers
   * other windows sharing the same partition (e.g. the sidebar webview).
   */
  private installSessionCookieBridge(partition: string): void {
    if (!partition.startsWith(SPARK_BROWSER_PARTITION_PREFIX)) return
    if (this.cookieBridgePartitions.has(partition)) return
    this.cookieBridgePartitions.add(partition)
    const ses = electronSession.fromPartition(partition)
    ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
      if (removed || cookie.expirationDate != null) return
      void persistSessionCookie(ses, cookie).catch((err) => {
        log.warn(
          `session cookie persist failed for ${cookie.name}@${cookie.domain}: ${String(err)}`,
        )
      })
    })
  }

  private attachWindowEvents(state: WindowState): void {
    state.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    state.win.webContents.on('did-attach-webview', (_event, contents: WebContents) => {
      state.pageWebContents = contents
      state.resolvePageReady?.(contents)
      state.resolvePageReady = null
      this.attachPageEvents(state, contents)
      this.installNetworkHooks(state, contents)
    })
    state.win.on('closed', () => {
      this.windows.delete(state.windowId)
    })
  }

  private attachPageEvents(state: WindowState, page: WebContents): void {
    page.setWindowOpenHandler(({ url }) => {
      void this.navigate(state.windowId, url).catch((err) =>
        log.warn(`windowOpen navigate failed: ${String(err)}`),
      )
      return { action: 'deny' }
    })
    page.on('did-navigate', (_event, url) => {
      state.url = url
      state.lastActiveAt = new Date().toISOString()
    })
    page.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame) this.clearMediaState(state)
    })
    page.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.clearMediaState(state)
      state.url = url
      state.lastActiveAt = new Date().toISOString()
    })
    page.on('page-title-updated', (_event, title) => {
      state.title = title
      state.lastActiveAt = new Date().toISOString()
    })
    page.on('dom-ready', () => {
      void this.runInjectedScripts(state)
    })
    page.on('console-message', (_event, level, message, line, sourceId) => {
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
  }

  private installNetworkHooks(state: WindowState, page: WebContents): void {
    if (state.networkHooksInstalled) return
    state.networkHooksInstalled = true
    const filter = { urls: ['*://*/*', 'file://*/*', 'data:*'] }
    const webContentsId = page.id
    const ses = page.session
    const isActive = (): boolean => this.windows.get(state.windowId) === state
    ses.webRequest.onBeforeRequest(filter, (details, callback) => {
      if (!isActive() || details.webContentsId !== webContentsId) return callback({})
      const rule = [...state.networkRules.values()].find((candidate) =>
        matchesRule(candidate, details.url),
      )
      pushBounded(state.networkEvents, {
        seq: ++state.networkSeq,
        kind:
          rule?.action === 'block'
            ? 'blocked'
            : rule?.action === 'redirect'
              ? 'redirected'
              : 'request',
        method: details.method,
        url: details.url,
        resourceType: details.resourceType,
        ...(rule?.id != null ? { ruleId: rule.id } : {}),
        ts: Date.now(),
      })
      if (rule?.action === 'block') return callback({ cancel: true })
      if (rule?.action === 'redirect' && rule.redirectUrl)
        return callback({ redirectURL: rule.redirectUrl })
      callback({})
    })
    ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      if (!isActive() || details.webContentsId !== webContentsId) {
        return callback({ requestHeaders: details.requestHeaders })
      }
      const headerRules = [...state.networkRules.values()].filter(
        (rule) =>
          rule.action === 'set_headers' && matchesRule(rule, details.url) && rule.headers != null,
      )
      if (headerRules.length === 0) return callback({ requestHeaders: details.requestHeaders })
      const requestHeaders = { ...details.requestHeaders }
      for (const rule of headerRules) Object.assign(requestHeaders, rule.headers)
      callback({ requestHeaders })
    })
    ses.webRequest.onCompleted(filter, (details) => {
      if (!isActive() || details.webContentsId !== webContentsId) return
      const mimeType = extractMimeType(details.responseHeaders)
      pushBounded(state.networkEvents, {
        seq: ++state.networkSeq,
        kind: 'completed',
        method: details.method,
        url: details.url,
        resourceType: details.resourceType,
        ...(mimeType == null ? {} : { mimeType }),
        statusCode: details.statusCode,
        ts: Date.now(),
      })
    })
    ses.webRequest.onErrorOccurred(filter, (details) => {
      if (!isActive() || details.webContentsId !== webContentsId) return
      pushBounded(state.networkEvents, {
        seq: ++state.networkSeq,
        kind: 'error',
        method: details.method,
        url: details.url,
        resourceType: details.resourceType,
        error: details.error,
        ts: Date.now(),
      })
    })
  }

  private async runInjectedScripts(state: WindowState): Promise<void> {
    const page = state.pageWebContents
    if (page == null || page.isDestroyed()) return
    for (const script of state.injectedScripts.values()) {
      try {
        await page.executeJavaScript(script.code, true)
      } catch (err) {
        log.warn(
          `Persistent script failed windowId=${state.windowId} scriptId=${script.scriptId}: ${String(err)}`,
        )
      }
    }
  }

  private async getPageWebContents(state: WindowState): Promise<WebContents> {
    const current = state.pageWebContents
    if (current != null && !current.isDestroyed()) return current
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        state.pageReady,
        new Promise<never>((_resolve, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Browser page did not attach')), 10_000)
        }),
      ])
    } catch (err) {
      throw new InternalBrowserError(
        'NAVIGATION_FAILED',
        err instanceof Error ? err.message : String(err),
        {
          windowId: state.windowId,
        },
      )
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }

  private requireWindow(windowId: string | undefined): WindowState {
    const target =
      windowId == null || windowId.trim() === ''
        ? [...this.windows.values()].find((state) => !state.win.isDestroyed())
        : this.windows.get(windowId)
    if (target == null || target.win.isDestroyed()) {
      throw new InternalBrowserError('WINDOW_NOT_FOUND', 'Browser window not found', { windowId })
    }
    return target
  }

  private clearMediaState(state: WindowState): void {
    state.mediaCandidates.clear()
    state.networkEvents = []
  }

  private meta(state: WindowState): InternalBrowserMeta {
    return {
      windowId: state.windowId,
      profileId: state.profileId,
      visible: state.win.isVisible(),
      url: state.pageWebContents?.getURL() || state.url,
      title: state.pageWebContents?.getTitle() || state.title,
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
