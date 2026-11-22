/**
 * 远程操作独立窗口服务。
 *
 * 远程界面默认属于主窗口侧栏导航；用户从页头切到独立窗口后，
 * 仍复用同一套 renderer 与中继链路，只把视图容器移到单独的 BrowserWindow。
 * 窗口策略与 QuickCreateWindowService 一致：单例，已打开则聚焦。
 */
import electron from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { createLogger } from '@spark/shared'
import type { RemoteControlWindowOpenResponse } from '@spark/protocol'
import { registerAppShutdownCleanup } from '../app-shutdown.js'
import { registerAppWindow } from '../windows/index.js'
import { buildWindowChromeOptions } from '../window-chrome.js'
import { typedIpcHandle } from '../ipc/typed-ipc.js'

const log = createLogger('remote-control-window')
const { BrowserWindow: ElectronBrowserWindow } = electron

type RemoteControlBrowserWindow = {
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

export interface RemoteControlWindowServiceDeps {
  createWindow: () => RemoteControlBrowserWindow
  getRendererUrl: () => string | undefined
  getRendererFile: () => string
  isDev: boolean
}

function buildRemoteControlWindowUrl(rendererUrl: string): string {
  const url = new URL(rendererUrl)
  url.searchParams.set('window', 'remote-control')
  return url.toString()
}

export class RemoteControlWindowService {
  private win: RemoteControlBrowserWindow | null = null

  constructor(private readonly deps: RemoteControlWindowServiceDeps) {}

  getWindow(): RemoteControlBrowserWindow | null {
    return this.win != null && !this.win.isDestroyed() ? this.win : null
  }

  async open(): Promise<RemoteControlWindowOpenResponse> {
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
          await win.loadURL(buildRemoteControlWindowUrl(rendererUrl))
          win.show()
          win.focus()
          return { success: true, windowId: win.id }
        }
      }

      await win.loadFile(this.deps.getRendererFile(), {
        query: { window: 'remote-control' },
      })
      win.show()
      win.focus()
      return { success: true, windowId: win.id }
    } catch (error) {
      log.error(`Failed to load remote control window: ${String(error)}`)
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

function createRemoteControlBrowserWindow(): RemoteControlBrowserWindow {
  const options: BrowserWindowConstructorOptions = {
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    center: true,
    show: false,
    title: 'SparkWork 远程',
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
  return new ElectronBrowserWindow(options) as RemoteControlBrowserWindow
}

let singleton: RemoteControlWindowService | null = null

export function getRemoteControlWindowService(): RemoteControlWindowService {
  if (singleton == null) {
    singleton = new RemoteControlWindowService({
      createWindow: createRemoteControlBrowserWindow,
      getRendererUrl: () => process.env['ELECTRON_RENDERER_URL'],
      getRendererFile: () => join(__dirname, '../renderer/index.html'),
      isDev: process.env['ELECTRON_RENDERER_URL'] != null,
    })
    registerAppShutdownCleanup('remote control window', () => {
      singleton?.close()
    })
  }
  return singleton
}

/** IPC 注册独立导出：ipc/index.ts 已过万行，不再向其堆叠 handler 逻辑 */
export function registerRemoteControlWindowIpc(): void {
  typedIpcHandle('remote-control:window:open', async (): Promise<RemoteControlWindowOpenResponse> => {
    return getRemoteControlWindowService().open()
  })
}
