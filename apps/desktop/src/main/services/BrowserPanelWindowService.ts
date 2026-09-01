/**
 * BrowserPanelWindowService — 内置浏览器「独立窗口」模式。
 *
 * 右侧面板（BrowserPanelView）与本服务创建的独立窗口共用同一套渲染端
 * BrowserChrome 组件：窗口加载渲染端入口并携带 `?window=browser&url=…`
 * 参数，由 renderer/browserWindowParams 路由到 BrowserWindowApp。
 *
 * 与 InternalBrowserService 的分工：后者是 spark_browser MCP 的自动化窗口
 * （shell HTML + webview，供 agent 控制），本服务是用户手动切换出的浏览
 * 器窗口（完整 React UI，支持多 tab / 元素拾取 / 调试工具）。
 */
import electron from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'
import { getMainWindow, registerAppWindow } from '../windows/index.js'

const log = createLogger('browser-panel-window')
const { app, BrowserWindow: ElectronBrowserWindow } = electron

export interface BrowserPanelWindowOpenRequest {
  url?: string
}

export interface BrowserPanelWindowOpenResponse {
  success: boolean
  windowId?: number
}

export interface BrowserPanelRestorePanelRequest {
  url?: string
}

export interface BrowserPanelRestorePanelResponse {
  success: boolean
}

type BrowserPanelWindow = {
  id: number
  webContents: {
    send: (channel: string, payload: unknown) => void
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => void
  }
  isDestroyed: () => boolean
  isVisible: () => boolean
  show: () => void
  focus: () => void
  loadURL: (url: string) => Promise<unknown>
  loadFile: (filePath: string, options?: { query?: Record<string, string> }) => Promise<unknown>
  on: (event: string, listener: (...args: unknown[]) => void) => void
  destroy: () => void
}

export interface BrowserPanelWindowServiceDeps {
  createWindow: () => BrowserPanelWindow
  getRendererUrl: () => string | undefined
  getRendererFile: () => string
  isDev: boolean
  getMainWindowWebContents: () => { send: (channel: string, payload: unknown) => void } | null
}

function buildBrowserWindowUrl(rendererUrl: string, url?: string): string {
  const target = new URL(rendererUrl)
  const params = new URLSearchParams({ window: 'browser' })
  if (url != null && url.trim().length > 0) params.set('url', url)
  // 独立窗口参数只供 renderer 自己消费，放进 hash 可避免 Vite dev server
  // 把 `/?window=browser&url=...` 误判为文件系统请求并返回 403。
  target.hash = params.toString()
  return target.toString()
}

export class BrowserPanelWindowService {
  private win: BrowserPanelWindow | null = null

  constructor(private readonly deps: BrowserPanelWindowServiceDeps) {}

  getWindow(): BrowserPanelWindow | null {
    return this.win != null && !this.win.isDestroyed() ? this.win : null
  }

  async open(req: BrowserPanelWindowOpenRequest): Promise<BrowserPanelWindowOpenResponse> {
    const existing = this.getWindow()
    if (existing != null) {
      // 已开窗口：聚焦并让渲染端把当前 tab 导航到目标地址
      if (req.url != null && req.url.trim().length > 0) {
        existing.webContents.send('stream:browser-window:navigate', { url: req.url })
      }
      if (!existing.isVisible()) existing.show()
      existing.focus()
      return { success: true, windowId: existing.id }
    }

    const win = this.deps.createWindow()
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    // 渲染端 index.html 固定 <title>SparkWork</title>，页面加载后会把构造时
    // 设置的 "SparkWork 浏览器" 覆盖回 "SparkWork"。拦截 page-title-updated，
    // 锁定窗口标题（同 CanvasWindowService）。
    win.on('page-title-updated', (event: unknown) => {
      if (hasPreventDefault(event)) event.preventDefault()
    })
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    registerAppWindow(win as never)
    this.win = win
    log.info('Browser panel window created')
    try {
      if (this.deps.isDev) {
        const rendererUrl = this.deps.getRendererUrl()
        if (rendererUrl != null) {
          await win.loadURL(buildBrowserWindowUrl(rendererUrl, req.url))
          win.show()
          return { success: true, windowId: win.id }
        }
      }
      const query: Record<string, string> = { window: 'browser' }
      if (req.url != null && req.url.trim().length > 0) query['url'] = req.url
      await win.loadFile(this.deps.getRendererFile(), { query })
      win.show()
      return { success: true, windowId: win.id }
    } catch (err) {
      log.error(`Failed to load browser panel window: ${String(err)}`)
      if (!win.isDestroyed()) win.destroy()
      if (this.win === win) this.win = null
      return { success: false }
    }
  }

  /** 独立窗口收回为右侧面板：通知主窗口打开面板，再关掉本窗口。 */
  restoreToPanel(req: BrowserPanelRestorePanelRequest): BrowserPanelRestorePanelResponse {
    const mainWebContents = this.deps.getMainWindowWebContents()
    if (mainWebContents == null) return { success: false }
    mainWebContents.send('stream:browser-panel:restore', { url: req.url })
    this.close()
    return { success: true }
  }

  /** 独立窗口内拾取的元素引用（JSON）转发回主窗口会话输入框。 */
  forwardPickToComposer(referenceJson: string): { success: boolean } {
    if (referenceJson.trim().length === 0) return { success: false }
    const mainWebContents = this.deps.getMainWindowWebContents()
    if (mainWebContents == null) return { success: false }
    mainWebContents.send('stream:browser-panel:element-picked', { referenceJson })
    return { success: true }
  }

  close(): boolean {
    const win = this.win
    if (win == null || win.isDestroyed()) return false
    win.destroy()
    this.win = null
    return true
  }
}

function createBrowserPanelBrowserWindow(): BrowserPanelWindow {
  const options: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 860,
    minWidth: 480,
    minHeight: 420,
    show: false,
    title: 'SparkWork 浏览器',
    autoHideMenuBar: true,
    backgroundColor: '#171717',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // 独立窗口内的 BrowserChrome 依赖 <webview> 渲染网页
      webviewTag: true,
    },
  }
  return new ElectronBrowserWindow(options) as unknown as BrowserPanelWindow
}

let singleton: BrowserPanelWindowService | null = null

export function getBrowserPanelWindowService(): BrowserPanelWindowService {
  if (singleton == null) {
    singleton = new BrowserPanelWindowService({
      createWindow: createBrowserPanelBrowserWindow,
      getRendererUrl: () => process.env['ELECTRON_RENDERER_URL'],
      getRendererFile: () => join(__dirname, '../renderer/index.html'),
      isDev: process.env['ELECTRON_RENDERER_URL'] != null,
      getMainWindowWebContents: () => {
        const win = getMainWindow()
        return win != null && !win.isDestroyed() ? win.webContents : null
      },
    })
    app.on('before-quit', () => {
      singleton?.close()
    })
  }
  return singleton
}

/**
 * 全局 webview popup 路由（main/index.ts 启动时安装一次）。
 *
 * <webview> 标签自身没有 setWindowOpenHandler API，页面里的 window.open /
 * target=_blank 统一在这里拦：deny 原生弹窗；当宿主是主窗口或独立浏览器窗口
 * （?window=browser）时，把 URL 推给对应渲染端转成新 tab。
 *
 * 顺序约定：InternalBrowserService（spark_browser MCP）在自己的
 * did-attach-webview 里会给同一个 webContents 再设自己的 handler（后设覆盖），
 * 因此其 shell 窗口的 webview 不受影响；这里遇到 data: 宿主也直接跳过。
 */
let popupRouterInstalled = false

export function installWebviewPopupRouter(): void {
  if (popupRouterInstalled) return
  popupRouterInstalled = true
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return
    const hostUrl = (() => {
      try {
        return contents.hostWebContents?.getURL() ?? ''
      } catch {
        return ''
      }
    })()
    // spark_browser MCP 的 shell 窗口是 data: URL 且自带 popup 处理，跳过
    if (hostUrl.startsWith('data:')) return
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const host = contents.hostWebContents
        if (host != null && !host.isDestroyed()) {
          const mainWin = getMainWindow()
          const isMainWindowHost =
            mainWin != null && !mainWin.isDestroyed() && mainWin.webContents.id === host.id
          const isBrowserPopoutHost = host.getURL().includes('window=browser')
          if (isMainWindowHost || isBrowserPopoutHost) {
            host.send('stream:browser-panel:open-tab', { url })
          }
        }
      } catch (err) {
        log.warn(`webview popup routing failed: ${String(err)}`)
      }
      return { action: 'deny' }
    })
  })
}

function hasPreventDefault(event: unknown): event is { preventDefault: () => void } {
  return (
    typeof event === 'object' &&
    event != null &&
    'preventDefault' in event &&
    typeof (event as { preventDefault?: unknown }).preventDefault === 'function'
  )
}
