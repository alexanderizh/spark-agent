import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { BrowserContext, Page } from 'playwright'
import { createLogger } from '@spark/shared'
import { registerAppShutdownCleanup } from '../app-shutdown.js'
import type {
  InternalBrowserDownloadResult,
  InternalBrowserMediaCandidate,
  InternalBrowserMediaInspection,
  InternalBrowserMeta,
} from './InternalBrowserService.js'
import { detectSystemBrowser } from './PlaywrightEnvironment.js'

const log = createLogger('system-browser')
const DEFAULT_PROFILE_ID = 'video-downloader-main'
const PROFILE_ID_RE = /^[a-zA-Z0-9_.-]{1,80}$/
const NAVIGATION_TIMEOUT_MS = 60_000
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

type PlaywrightChromium = {
  launchPersistentContext: (
    userDataDir: string,
    options: {
      channel: 'chrome' | 'msedge'
      headless: false
      acceptDownloads: true
      viewport: null
    },
  ) => Promise<BrowserContext>
}

type NetworkEvent = {
  url: string
  resourceType?: string
  mimeType?: string
}

type SystemWindowState = {
  windowId: string
  profileId: string
  context: BrowserContext
  page: Page
  networkEvents: NetworkEvent[]
  mediaCandidates: Map<string, InternalBrowserMediaCandidate['kind']>
  createdAt: string
  lastActiveAt: string
}

export type SystemBrowserServiceDeps = {
  launchPersistentContext?: PlaywrightChromium['launchPersistentContext']
  getBrowserChannel?: () => 'chrome' | 'msedge' | null
  getProfileRoot?: () => string
}

export class SystemBrowserError extends Error {
  constructor(
    readonly code:
      | 'SYSTEM_BROWSER_UNAVAILABLE'
      | 'SYSTEM_BROWSER_LAUNCH_FAILED'
      | 'WINDOW_NOT_FOUND'
      | 'INVALID_MEDIA_URL'
      | 'DOWNLOAD_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'SystemBrowserError'
  }
}

function getChromium(): PlaywrightChromium {
  try {
    const require = createRequire(import.meta.url)
    const playwright = require('playwright') as { chromium?: PlaywrightChromium }
    if (playwright.chromium != null) return playwright.chromium
  } catch (error) {
    throw new SystemBrowserError(
      'SYSTEM_BROWSER_LAUNCH_FAILED',
      `无法加载 Playwright 浏览器运行时：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  throw new SystemBrowserError(
    'SYSTEM_BROWSER_LAUNCH_FAILED',
    '当前桌面版本未包含 Playwright 浏览器运行时。',
  )
}

function validateProfileId(profileId: string | undefined): string {
  const value = (profileId ?? DEFAULT_PROFILE_ID).trim() || DEFAULT_PROFILE_ID
  if (!PROFILE_ID_RE.test(value)) {
    throw new SystemBrowserError('SYSTEM_BROWSER_LAUNCH_FAILED', '浏览器配置标识无效。')
  }
  return value
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
  ) {
    return 'mp4'
  }
  if (/\.m3u8(?:[?#]|$)/.test(lower) || mime.includes('mpegurl') || mime.includes('x-mpegurl')) {
    return 'hls'
  }
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
  return `${base}${(kindOverride ?? mediaKind(mediaUrl)) === 'mp4' ? '.mp4' : '.bin'}`
}

function isNavigationTimeout(error: unknown): boolean {
  return error instanceof Error && /timeout/i.test(error.message)
}

export class SystemBrowserService {
  private readonly windows = new Map<string, SystemWindowState>()
  private readonly launchPersistentContext: PlaywrightChromium['launchPersistentContext']
  private readonly getBrowserChannel: () => 'chrome' | 'msedge' | null
  private readonly getProfileRoot: () => string

  constructor(deps: SystemBrowserServiceDeps = {}) {
    this.launchPersistentContext =
      deps.launchPersistentContext ??
      ((userDataDir, options) => getChromium().launchPersistentContext(userDataDir, options))
    this.getBrowserChannel = deps.getBrowserChannel ?? detectSystemBrowser
    this.getProfileRoot =
      deps.getProfileRoot ?? (() => path.join(app.getPath('userData'), 'browser-profiles'))
  }

  bindLifecycle(): void {
    registerAppShutdownCleanup('system browser windows', () => this.closeAll())
  }

  async openWindow(opts: {
    url: string
    show?: boolean
    profileId?: string
    reuse?: boolean
  }): Promise<InternalBrowserMeta> {
    const profileId = validateProfileId(opts.profileId)
    const existing =
      opts.reuse === true
        ? [...this.windows.values()].find(
            (state) => state.profileId === profileId && !state.page.isClosed(),
          )
        : undefined
    if (existing != null) {
      if (opts.show !== false) await existing.page.bringToFront()
      await this.navigate(existing.windowId, opts.url)
      return this.meta(existing)
    }

    const channel = this.getBrowserChannel()
    if (channel == null) {
      throw new SystemBrowserError('SYSTEM_BROWSER_UNAVAILABLE', '未检测到本机 Chrome 或 Edge。')
    }

    const profileRoot = path.join(this.getProfileRoot(), profileId)
    mkdirSync(profileRoot, { recursive: true })
    let context: BrowserContext
    try {
      context = await this.launchPersistentContext(profileRoot, {
        channel,
        headless: false,
        acceptDownloads: true,
        viewport: null,
      })
    } catch (error) {
      throw new SystemBrowserError(
        'SYSTEM_BROWSER_LAUNCH_FAILED',
        `无法启动本机 ${channel === 'msedge' ? 'Edge' : 'Chrome'}：${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const page = context.pages()[0] ?? (await context.newPage())
    const windowId = `system-browser-${randomUUID()}`
    const now = new Date().toISOString()
    const state: SystemWindowState = {
      windowId,
      profileId,
      context,
      page,
      networkEvents: [],
      mediaCandidates: new Map(),
      createdAt: now,
      lastActiveAt: now,
    }
    this.windows.set(windowId, state)
    this.attachPageEvents(state)
    context.on('close', () => {
      this.windows.delete(windowId)
    })
    page.on('close', () => {
      this.windows.delete(windowId)
    })

    try {
      await this.navigate(windowId, opts.url)
      if (opts.show !== false) await page.bringToFront()
      return this.meta(state)
    } catch (error) {
      this.windows.delete(windowId)
      await context.close().catch(() => {})
      if (error instanceof SystemBrowserError) throw error
      throw new SystemBrowserError(
        'SYSTEM_BROWSER_LAUNCH_FAILED',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  async inspectMedia(windowId: string): Promise<InternalBrowserMediaInspection> {
    const state = this.requireWindow(windowId)
    let domResult: { pageUrl?: unknown; title?: unknown; candidates?: unknown }
    try {
      domResult = (await state.page.evaluate(MEDIA_INSPECTION_SCRIPT)) as typeof domResult
    } catch (error) {
      throw new SystemBrowserError(
        'WINDOW_NOT_FOUND',
        `无法读取本机浏览器页面：${error instanceof Error ? error.message : String(error)}`,
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
      if (!isLikelyMediaUrl(event.url, event.resourceType, event.mimeType)) continue
      addCandidate(event.url, 'network', { kind: mediaKind(event.url, event.mimeType) })
    }

    state.lastActiveAt = new Date().toISOString()
    return {
      pageUrl:
        typeof domResult?.pageUrl === 'string' ? domResult.pageUrl : state.page.url() || null,
      title:
        typeof domResult?.title === 'string'
          ? domResult.title
          : await state.page.title().catch(() => null),
      candidates,
    }
  }

  async downloadMedia(
    windowId: string,
    mediaUrl: string,
    filename?: string,
  ): Promise<InternalBrowserDownloadResult> {
    const state = this.requireWindow(windowId)
    if (!isHttpUrl(mediaUrl)) {
      throw new SystemBrowserError('INVALID_MEDIA_URL', '媒体地址必须是 http(s) URL。')
    }
    const candidateKind = state.mediaCandidates.get(mediaUrl)
    if (candidateKind == null) {
      throw new SystemBrowserError('INVALID_MEDIA_URL', '媒体地址不是当前页面抓取到的播放资源。')
    }

    const safeFilename = sanitizeDownloadFilename(filename, mediaUrl, candidateKind)
    const destination = path.join(app.getPath('downloads'), safeFilename)
    const referer = state.page.url()
    const userAgent = await state.page.evaluate(() => navigator.userAgent).catch(() => undefined)
    const headers: Record<string, string> = {
      ...(referer ? { Referer: referer } : {}),
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
    }

    let response: {
      ok(): boolean
      status(): number
      headers(): Record<string, string>
      body(): Promise<Buffer>
      dispose(): Promise<void>
    } | null = null
    try {
      response = await state.context.request.get(mediaUrl, {
        headers,
        timeout: DOWNLOAD_TIMEOUT_MS,
      })
      if (!response.ok()) throw new Error(`媒体请求失败（HTTP ${response.status()}）`)
      const contentType = response.headers()['content-type']?.toLowerCase() ?? ''
      if (contentType.startsWith('text/html'))
        throw new Error('媒体请求返回了网页内容，可能需要在本机浏览器中完成登录。')
      const body = await response.body()
      if (body.length === 0) throw new Error('媒体响应为空。')
      await writeFile(destination, body)
      state.lastActiveAt = new Date().toISOString()
      return { path: destination, filename: safeFilename, size: body.length }
    } catch (error) {
      if (error instanceof SystemBrowserError) throw error
      throw new SystemBrowserError(
        'DOWNLOAD_FAILED',
        error instanceof Error ? error.message : String(error),
      )
    } finally {
      await response?.dispose().catch(() => {})
    }
  }

  async closeWindow(windowId: string): Promise<{ ok: true }> {
    const state = this.requireWindow(windowId)
    this.windows.delete(windowId)
    await state.context.close().catch(() => {})
    return { ok: true }
  }

  async closeAll(): Promise<void> {
    const states = [...this.windows.values()]
    this.windows.clear()
    await Promise.all(states.map((state) => state.context.close().catch(() => {})))
  }

  private async navigate(windowId: string, url: string): Promise<void> {
    const state = this.requireWindow(windowId)
    if (!isHttpUrl(url))
      throw new SystemBrowserError('SYSTEM_BROWSER_LAUNCH_FAILED', '页面地址必须是 http(s) URL。')
    state.networkEvents = []
    state.mediaCandidates.clear()
    try {
      await state.page.goto(url, { waitUntil: 'commit', timeout: NAVIGATION_TIMEOUT_MS })
      state.lastActiveAt = new Date().toISOString()
    } catch (error) {
      if (isNavigationTimeout(error) && !state.page.isClosed()) {
        log.warn(`System browser navigation timed out but page remains available: ${url}`)
        return
      }
      throw new SystemBrowserError(
        'SYSTEM_BROWSER_LAUNCH_FAILED',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  private attachPageEvents(state: SystemWindowState): void {
    state.page.on('request', (request) => {
      this.recordNetworkEvent(state, request.url(), request.resourceType())
    })
    state.page.on('response', (response) => {
      void response
        .allHeaders()
        .then((headers) => {
          if (!this.windows.has(state.windowId)) return
          this.recordNetworkEvent(
            state,
            response.url(),
            response.request().resourceType(),
            headers['content-type'],
          )
        })
        .catch(() => {})
    })
  }

  private recordNetworkEvent(
    state: SystemWindowState,
    url: string,
    resourceType?: string,
    mimeType?: string,
  ): void {
    if (!isHttpUrl(url) || !this.windows.has(state.windowId)) return
    state.networkEvents.push({
      url,
      ...(resourceType === undefined ? {} : { resourceType }),
      ...(mimeType === undefined ? {} : { mimeType }),
    })
    if (state.networkEvents.length > 500)
      state.networkEvents.splice(0, state.networkEvents.length - 500)
  }

  private requireWindow(windowId: string): SystemWindowState {
    const state = this.windows.get(windowId)
    if (state == null || state.page.isClosed()) {
      this.windows.delete(windowId)
      throw new SystemBrowserError('WINDOW_NOT_FOUND', '本机浏览器窗口已关闭。')
    }
    return state
  }

  private meta(state: SystemWindowState): InternalBrowserMeta {
    return {
      windowId: state.windowId,
      profileId: state.profileId,
      visible: !state.page.isClosed(),
      url: state.page.url() || null,
      title: null,
      injectedScriptCount: 0,
      networkRuleCount: 0,
      consoleEventCount: 0,
    }
  }
}
