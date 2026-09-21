/**
 * 快速创作独立窗口服务。
 *
 * 快速创作默认属于主窗口的画布导航；用户从页头切换到独立窗口后，
 * 仍复用同一套 renderer 与任务流，只把页面容器移到单独的 BrowserWindow。
 */
import electron from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'
import { registerAppShutdownCleanup } from '../app-shutdown.js'
import { registerAppWindow } from '../windows/index.js'
import { buildWindowChromeOptions } from '../window-chrome.js'

const log = createLogger('quick-create-window')
const { BrowserWindow: ElectronBrowserWindow } = electron

export interface QuickCreateWindowOpenResponse {
  success: boolean
  windowId?: number
}

type QuickCreateBrowserWindow = {
  id: number
  webContents: {
    setWindowOpenHandler: (handler: () => { action: 'deny' }) => void
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

export interface QuickCreateWindowServiceDeps {
  createWindow: () => QuickCreateBrowserWindow
  getRendererUrl: () => string | undefined
  getRendererFile: () => string
  isDev: boolean
}

function buildQuickCreateWindowUrl(rendererUrl: string): string {
  const url = new URL(rendererUrl)
  url.searchParams.set('window', 'quick-create')
  return url.toString()
}

export class QuickCreateWindowService {
  private win: QuickCreateBrowserWindow | null = null

  constructor(private readonly deps: QuickCreateWindowServiceDeps) {}

  getWindow(): QuickCreateBrowserWindow | null {
    return this.win != null && !this.win.isDestroyed() ? this.win : null
  }

  async open(): Promise<QuickCreateWindowOpenResponse> {
    const existing = this.getWindow()
    if (existing != null) {
      if (!existing.isVisible()) existing.show()
      existing.focus()
      return { success: true, windowId: existing.id }
    }

    const win = this.deps.createWindow()
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('page-title-updated', (event: unknown) => {
      if (hasPreventDefault(event)) event.preventDefault()
    })
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    registerAppWindow(win as never)
    this.win = win

    try {
      if (this.deps.isDev) {
        const rendererUrl = this.deps.getRendererUrl()
        if (rendererUrl != null) {
          await win.loadURL(buildQuickCreateWindowUrl(rendererUrl))
          win.show()
          win.focus()
          return { success: true, windowId: win.id }
        }
      }

      await win.loadFile(this.deps.getRendererFile(), {
        query: { window: 'quick-create' },
      })
      win.show()
      win.focus()
      return { success: true, windowId: win.id }
    } catch (error) {
      log.error(`Failed to load quick create window: ${String(error)}`)
      if (!win.isDestroyed()) win.destroy()
      if (this.win === win) this.win = null
      return { success: false }
    }
  }

  close(): boolean {
    const win = this.win
    if (win == null || win.isDestroyed()) return false
    win.destroy()
    this.win = null
    return true
  }
}

function hasPreventDefault(event: unknown): event is { preventDefault: () => void } {
  return (
    typeof event === 'object' &&
    event != null &&
    'preventDefault' in event &&
    typeof (event as { preventDefault?: unknown }).preventDefault === 'function'
  )
}

function createQuickCreateBrowserWindow(): QuickCreateBrowserWindow {
  const options: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    center: true,
    show: false,
    title: 'SparkWork 快速创作',
    autoHideMenuBar: true,
    backgroundColor: '#f7f7f5',
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
  return new ElectronBrowserWindow(options) as QuickCreateBrowserWindow
}

let singleton: QuickCreateWindowService | null = null

export function getQuickCreateWindowService(): QuickCreateWindowService {
  if (singleton == null) {
    singleton = new QuickCreateWindowService({
      createWindow: createQuickCreateBrowserWindow,
      getRendererUrl: () => process.env['ELECTRON_RENDERER_URL'],
      getRendererFile: () => join(__dirname, '../renderer/index.html'),
      isDev: process.env['ELECTRON_RENDERER_URL'] != null,
    })
    registerAppShutdownCleanup('quick create window', () => {
      singleton?.close()
    })
  }
  return singleton
}
