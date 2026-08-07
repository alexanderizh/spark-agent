import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  createWindow: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(() => electronMocks.createWindow()),
  session: {
    fromPartition: vi.fn(),
  },
}))

import { InternalBrowserService } from '../InternalBrowserService.js'

type NetworkListener = (...args: never[]) => void

function createFakeBrowserWindow(): {
  win: Record<string, unknown>
  pageWebContents: {
    executeJavaScript: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    capturePage: ReturnType<typeof vi.fn>
  }
  shellCapturePage: ReturnType<typeof vi.fn>
  closeManually: () => void
  networkListeners: Record<string, NetworkListener>
} {
  let destroyed = false
  const windowListeners = new Map<string, () => void>()
  const shellListeners = new Map<string, (...args: unknown[]) => void>()
  const networkListeners: Record<string, NetworkListener> = {}
  const webRequest = {
    onBeforeRequest: vi.fn((_filter, listener) => {
      networkListeners.onBeforeRequest = listener
    }),
    onBeforeSendHeaders: vi.fn((_filter, listener) => {
      networkListeners.onBeforeSendHeaders = listener
    }),
    onCompleted: vi.fn((_filter, listener) => {
      networkListeners.onCompleted = listener
    }),
    onErrorOccurred: vi.fn((_filter, listener) => {
      networkListeners.onErrorOccurred = listener
    }),
  }
  const pageWebContents = {
    id: 42,
    session: { webRequest },
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    getURL: vi.fn(() => 'https://example.com'),
    getTitle: vi.fn(() => 'Example'),
    loadURL: vi.fn(() => Promise.resolve()),
    executeJavaScript: vi.fn(),
    capturePage: vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,test' })),
    isDestroyed: vi.fn(() => destroyed),
  }
  const webContents = {
    id: 1,
    setWindowOpenHandler: vi.fn(),
    on: vi.fn((eventName: string, listener: (...args: unknown[]) => void) => {
      shellListeners.set(eventName, listener)
    }),
    capturePage: vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,window' })),
  }
  const win: Record<string, unknown> = {
    isDestroyed: vi.fn(() => destroyed),
    isVisible: vi.fn(() => true),
    show: vi.fn(),
    loadURL: vi.fn(async () => {
      shellListeners.get('did-attach-webview')?.({}, pageWebContents, {})
    }),
    getTitle: vi.fn(() => 'Example'),
    on: vi.fn((eventName: string, listener: () => void) => {
      windowListeners.set(eventName, listener)
    }),
    removeAllListeners: vi.fn(),
    destroy: vi.fn(),
  }
  Object.defineProperty(win, 'webContents', {
    get() {
      if (destroyed) throw new TypeError('Object has been destroyed')
      return webContents
    },
  })

  return {
    win,
    pageWebContents,
    shellCapturePage: webContents.capturePage,
    networkListeners,
    closeManually: () => {
      destroyed = true
      windowListeners.get('closed')?.()
    },
  }
}

describe('InternalBrowserService', () => {
  beforeEach(() => {
    electronMocks.createWindow.mockReset()
  })

  it('ignores late network events after the user manually closes the browser window', async () => {
    const fake = createFakeBrowserWindow()
    electronMocks.createWindow.mockReturnValue(fake.win)
    const service = new InternalBrowserService()

    await service.openWindow({ url: 'https://example.com' })
    fake.closeManually()

    const beforeRequestCallback = vi.fn()
    expect(() => {
      fake.networkListeners.onBeforeRequest?.({
        webContentsId: 42,
        method: 'GET',
        url: 'https://example.com',
      } as never, beforeRequestCallback as never)
    }).not.toThrow()
    expect(beforeRequestCallback).toHaveBeenCalledWith({})

    const requestHeaders = { Accept: 'text/html' }
    const beforeSendHeadersCallback = vi.fn()
    expect(() => {
      fake.networkListeners.onBeforeSendHeaders?.({
        webContentsId: 42,
        method: 'GET',
        url: 'https://example.com',
        requestHeaders,
      } as never, beforeSendHeadersCallback as never)
    }).not.toThrow()
    expect(beforeSendHeadersCallback).toHaveBeenCalledWith({ requestHeaders })

    expect(() => {
      fake.networkListeners.onCompleted?.({
        webContentsId: 42,
        method: 'GET',
        url: 'https://example.com',
        statusCode: 200,
      } as never)
    }).not.toThrow()
    expect(() => {
      fake.networkListeners.onErrorOccurred?.({
        webContentsId: 42,
        method: 'GET',
        url: 'https://example.com/favicon.ico',
        error: 'net::ERR_ABORTED',
      } as never)
    }).not.toThrow()
    expect(service.listWindows()).toEqual([])
  })

  it('keeps automation calls on the embedded page instead of the browser toolbar shell', async () => {
    const fake = createFakeBrowserWindow()
    electronMocks.createWindow.mockReturnValue(fake.win)
    const service = new InternalBrowserService()

    await service.openWindow({ url: 'https://example.com' })
    await service.evalJs(undefined, 'document.title')

    expect(fake.pageWebContents.executeJavaScript).toHaveBeenCalledWith('document.title', true)
    expect(fake.pageWebContents.loadURL).toHaveBeenCalledWith('https://example.com')
  })

  it('captures the complete browser window, including the toolbar shell', async () => {
    const fake = createFakeBrowserWindow()
    electronMocks.createWindow.mockReturnValue(fake.win)
    const service = new InternalBrowserService()

    await service.openWindow({ url: 'https://example.com' })
    const result = await service.screenshot(undefined)

    expect(fake.shellCapturePage).toHaveBeenCalledOnce()
    expect(fake.pageWebContents.capturePage).not.toHaveBeenCalled()
    expect(result.dataUrl).toBe('data:image/png;base64,window')
  })
})
