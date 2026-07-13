import electron from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { createLogger, SparkError } from '@spark/shared'
import { registerAppWindow } from '../windows/index.js'

const log = createLogger('canvas-window')
const { app, BrowserWindow: ElectronBrowserWindow, shell } = electron
const CANVAS_WINDOW_NAVIGATION_BLOCKED_MESSAGE =
  '当前画布有未保存修改，请先保存或关闭当前画布后再打开其他画布。'

export interface CanvasWindowOpenRequest {
  projectId: string
}

export interface CanvasWindowOpenResponse {
  success: boolean
  windowId: number
  projectId: string
}

type CanvasBrowserWindow = {
  id: number
  webContents: {
    setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => void
    send: (channel: string, payload: unknown) => void
  }
  isDestroyed: () => boolean
  isVisible: () => boolean
  show: () => void
  focus: () => void
  loadURL: (url: string) => Promise<unknown>
  loadFile: (filePath: string, options?: { query?: Record<string, string> }) => Promise<unknown>
  once: (event: string, listener: (...args: unknown[]) => void) => void
  on: (event: string, listener: (...args: unknown[]) => void) => void
  close: () => void
  destroy: () => void
}

export interface CanvasWindowServiceDeps {
  createWindow: () => CanvasBrowserWindow
  getRendererUrl: () => string | undefined
  getRendererFile: () => string
  isDev: boolean
  openExternal: (url: string) => void
}

function buildCanvasWindowUrl(rendererUrl: string, projectId: string): string {
  const url = new URL(rendererUrl)
  url.searchParams.set('window', 'canvas')
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

export class CanvasWindowService {
  private win: CanvasBrowserWindow | null = null
  private activeProjectId: string | null = null
  private allowCloseOnce = false

  constructor(private readonly deps: CanvasWindowServiceDeps) {}

  async open(req: CanvasWindowOpenRequest): Promise<CanvasWindowOpenResponse> {
    const win = this.ensureWindow()
    if (this.activeProjectId !== req.projectId) {
      const previousProjectId = this.activeProjectId
      try {
        await this.loadProject(win, req.projectId)
        this.activeProjectId = req.projectId
      } catch (error) {
        this.activeProjectId = previousProjectId
        if (isNavigationCancelledByRendererGuard(error)) {
          if (!win.isVisible()) win.show()
          win.focus()
          throw new SparkError('VALIDATION_FAILED', CANVAS_WINDOW_NAVIGATION_BLOCKED_MESSAGE)
        }
        throw error
      }
    }
    if (!win.isVisible()) win.show()
    win.focus()
    return { success: true, windowId: win.id, projectId: req.projectId }
  }

  focus(): boolean {
    const win = this.win
    if (win == null || win.isDestroyed()) return false
    if (!win.isVisible()) win.show()
    win.focus()
    return true
  }

  close(): boolean {
    const win = this.win
    if (win == null || win.isDestroyed()) return false
    win.destroy()
    this.win = null
    this.activeProjectId = null
    return true
  }

  closeAfterRendererGuard(): boolean {
    const win = this.win
    if (win == null || win.isDestroyed()) return false
    this.allowCloseOnce = true
    win.close()
    return true
  }

  getWindow(): CanvasBrowserWindow | null {
    return this.win != null && !this.win.isDestroyed() ? this.win : null
  }

  getActiveProjectId(): string | null {
    return this.activeProjectId
  }

  private ensureWindow(): CanvasBrowserWindow {
    if (this.win != null && !this.win.isDestroyed()) return this.win

    const win = this.deps.createWindow()
    win.webContents.setWindowOpenHandler((details) => {
      this.deps.openExternal(details.url)
      return { action: 'deny' }
    })
    win.on('close', (event: unknown) => {
      if (this.allowCloseOnce) {
        this.allowCloseOnce = false
        return
      }
      if (this.activeProjectId == null) return
      if (hasPreventDefault(event)) event.preventDefault()
      win.webContents.send('stream:canvas-window:close-request', {
        projectId: this.activeProjectId,
      })
    })
    win.on('closed', () => {
      if (this.win === win) {
        this.win = null
        this.activeProjectId = null
        this.allowCloseOnce = false
      }
    })
    registerAppWindow(win as never)
    this.win = win
    log.info('Canvas window created')
    return win
  }

  private async loadProject(win: CanvasBrowserWindow, projectId: string): Promise<void> {
    if (this.deps.isDev) {
      const rendererUrl = this.deps.getRendererUrl()
      if (rendererUrl != null) {
        await win.loadURL(buildCanvasWindowUrl(rendererUrl, projectId))
        return
      }
    }
    await win.loadFile(this.deps.getRendererFile(), {
      query: { window: 'canvas', projectId },
    })
  }
}

function isNavigationCancelledByRendererGuard(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message.includes('ERR_FAILED (-2) loading')
}

function hasPreventDefault(event: unknown): event is { preventDefault: () => void } {
  return (
    typeof event === 'object' &&
    event != null &&
    'preventDefault' in event &&
    typeof (event as { preventDefault?: unknown }).preventDefault === 'function'
  )
}

function createCanvasBrowserWindow(): CanvasBrowserWindow {
  const isDarwin = process.platform === 'darwin'
  const options: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'SparkWork · Canvas',
    autoHideMenuBar: true,
    backgroundColor: '#111113',
    hasShadow: true,
    titleBarStyle: isDarwin ? 'hiddenInset' : 'hidden',
    ...(isDarwin ? { trafficLightPosition: { x: 22, y: 20 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  }
  return new ElectronBrowserWindow(options) as CanvasBrowserWindow
}

let singleton: CanvasWindowService | null = null

export function getCanvasWindowService(): CanvasWindowService {
  if (singleton == null) {
    singleton = new CanvasWindowService({
      createWindow: createCanvasBrowserWindow,
      getRendererUrl: () => process.env['ELECTRON_RENDERER_URL'],
      getRendererFile: () => join(__dirname, '../renderer/index.html'),
      isDev: process.env['ELECTRON_RENDERER_URL'] != null,
      openExternal: (url) => {
        void shell.openExternal(url)
      },
    })
    app.on('before-quit', () => {
      singleton?.close()
    })
  }
  return singleton
}
