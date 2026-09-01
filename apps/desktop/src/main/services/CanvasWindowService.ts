import electron from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { createLogger, SparkError } from '@spark/shared'
import { registerAppWindow } from '../windows/index.js'
import { buildWindowChromeOptions } from '../window-chrome.js'
import { openExternalUrlSafely } from './ExternalUrlPolicy.js'

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
  maximize: () => void
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

/** 画布项目退出编辑（窗口关闭或切换到其他项目）时触发 */
export type CanvasProjectExitedHandler = (projectId: string) => void

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
  private projectExitedHandler: CanvasProjectExitedHandler | null = null

  constructor(private readonly deps: CanvasWindowServiceDeps) {}

  /**
   * 注册「画布项目退出编辑」回调：窗口关闭或切换到其他项目时触发。
   * 用于上层做善后清理（如收紧该项目的历史快照），回调抛错只记日志。
   */
  onProjectExited(handler: CanvasProjectExitedHandler): void {
    this.projectExitedHandler = handler
  }

  private notifyProjectExited(projectId: string | null): void {
    if (projectId == null || this.projectExitedHandler == null) return
    try {
      this.projectExitedHandler(projectId)
    } catch (error) {
      log.warn(`Canvas project exit handler failed for ${projectId}: ${String(error)}`)
    }
  }

  async open(req: CanvasWindowOpenRequest): Promise<CanvasWindowOpenResponse> {
    const win = this.ensureWindow()
    if (this.activeProjectId !== req.projectId) {
      const previousProjectId = this.activeProjectId
      try {
        await this.loadProject(win, req.projectId)
        this.activeProjectId = req.projectId
        this.notifyProjectExited(previousProjectId)
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
    const exitingProjectId = this.activeProjectId
    win.destroy()
    this.win = null
    this.activeProjectId = null
    this.notifyProjectExited(exitingProjectId)
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
    // 渲染端 index.html 固定 <title>SparkWork</title>，页面加载后会把构造时
    // 设置的窗口名覆盖回 "SparkWork"，导致 Dock 右键窗口列表里主窗口与画布
    // 窗口同名无法区分。拦截 page-title-updated，锁定画布窗口标题。
    win.on('page-title-updated', (event: unknown) => {
      if (hasPreventDefault(event)) event.preventDefault()
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
        const exitingProjectId = this.activeProjectId
        log.warn(`[quit-forensics] canvas window closed; project=${exitingProjectId ?? 'none'}`)
        this.win = null
        this.activeProjectId = null
        this.allowCloseOnce = false
        this.notifyProjectExited(exitingProjectId)
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
  const options: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'SparkWork 画布',
    autoHideMenuBar: true,
    backgroundColor: '#111113',
    hasShadow: true,
    ...buildWindowChromeOptions(process.platform),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  }
  // 打开即「最大化」(非全屏):撑满屏幕工作区、保留标题栏/Dock、不进 fullscreen,
  // 用户仍可手动还原。窗口 show:false 创建,最大化发生在显示之前,show 时无闪烁。
  const win = new ElectronBrowserWindow(options) as CanvasBrowserWindow
  win.maximize()
  return win
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
        void openExternalUrlSafely(url, (target) => shell.openExternal(target))
      },
    })
    app.on('before-quit', () => {
      singleton?.close()
    })
  }
  return singleton
}
