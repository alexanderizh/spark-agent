import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  createWindow: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/Users/test/Downloads'),
  },
  BrowserWindow: vi.fn(() => electronMocks.createWindow()),
  // 内置浏览器会对 spark-browser 分区开启会话 cookie 持久化桥（cookies.on('changed')），
  // clearProfile 也会调用 clearCache/clearStorageData，因此 fromPartition 必须返回可用的假会话。
  session: {
    fromPartition: vi.fn(() => ({
      cookies: {
        set: vi.fn(async () => undefined),
        on: vi.fn(),
      },
      clearCache: vi.fn(async () => undefined),
      clearStorageData: vi.fn(async () => undefined),
    })),
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
    downloadURL: ReturnType<typeof vi.fn>
  }
  shellCapturePage: ReturnType<typeof vi.fn>
  closeManually: () => void
  networkListeners: Record<string, NetworkListener>
  downloadListeners: Record<string, (...args: unknown[]) => void>
} {
  let destroyed = false
  const windowListeners = new Map<string, () => void>()
  const shellListeners = new Map<string, (...args: unknown[]) => void>()
  const networkListeners: Record<string, NetworkListener> = {}
  const downloadListeners: Record<string, (...args: unknown[]) => void> = {}
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
  const downloadSession = {
    webRequest,
    once: vi.fn((eventName: string, listener: (...args: unknown[]) => void) => {
      downloadListeners[eventName] = listener
    }),
    removeListener: vi.fn((eventName: string) => {
      delete downloadListeners[eventName]
    }),
  }
  const pageWebContents = {
    id: 42,
    session: downloadSession,
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    getURL: vi.fn(() => 'https://example.com'),
    getTitle: vi.fn(() => 'Example'),
    loadURL: vi.fn(() => Promise.resolve()),
    executeJavaScript: vi.fn(),
    downloadURL: vi.fn(),
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
    downloadListeners,
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
      fake.networkListeners.onBeforeRequest?.(
        {
          webContentsId: 42,
          method: 'GET',
          url: 'https://example.com',
        } as never,
        beforeRequestCallback as never,
      )
    }).not.toThrow()
    expect(beforeRequestCallback).toHaveBeenCalledWith({})

    const requestHeaders = { Accept: 'text/html' }
    const beforeSendHeadersCallback = vi.fn()
    expect(() => {
      fake.networkListeners.onBeforeSendHeaders?.(
        {
          webContentsId: 42,
          method: 'GET',
          url: 'https://example.com',
          requestHeaders,
        } as never,
        beforeSendHeadersCallback as never,
      )
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

  it('can close an explicitly selected browser window', async () => {
    const fake = createFakeBrowserWindow()
    electronMocks.createWindow.mockReturnValue(fake.win)
    const service = new InternalBrowserService()

    const opened = await service.openWindow({ url: 'https://example.com' })
    expect(service.closeWindow(opened.windowId)).toEqual({ ok: true })
    expect(fake.win.destroy).toHaveBeenCalledOnce()
    expect(service.listWindows()).toEqual([])
  })

  it('clears old media at navigation start and keeps media requests from the new page', async () => {
    const fake = createFakeBrowserWindow()
    electronMocks.createWindow.mockReturnValue(fake.win)
    const service = new InternalBrowserService()

    await service.openWindow({ url: 'https://example.com/old' })
    fake.networkListeners.onBeforeRequest?.(
      {
        webContentsId: 42,
        method: 'GET',
        url: 'https://cdn.example/old-video',
        resourceType: 'media',
      } as never,
      vi.fn() as never,
    )

    fake.pageWebContents.loadURL.mockImplementationOnce(async () => {
      fake.networkListeners.onBeforeRequest?.(
        {
          webContentsId: 42,
          method: 'GET',
          url: 'https://cdn.example/new-video?token=1',
          resourceType: 'media',
        } as never,
        vi.fn() as never,
      )
    })
    fake.pageWebContents.executeJavaScript.mockResolvedValueOnce({
      pageUrl: 'https://example.com/new',
      title: '新页面',
      candidates: [],
    })

    await service.navigate(undefined, 'https://example.com/new')
    const inspection = await service.inspectMedia(undefined)

    expect(inspection.candidates).toEqual([
      {
        url: 'https://cdn.example/new-video?token=1',
        source: 'network',
        kind: 'unknown',
      },
    ])
    expect(inspection.candidates).not.toContainEqual(
      expect.objectContaining({ url: 'https://cdn.example/old-video' }),
    )
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

  it('读取页面 video/source 节点并通过同一浏览器会话下载媒体', async () => {
    const fake = createFakeBrowserWindow()
    electronMocks.createWindow.mockReturnValue(fake.win)
    const service = new InternalBrowserService()
    fake.pageWebContents.executeJavaScript.mockResolvedValueOnce({
      pageUrl: 'https://www.douyin.com/video/1',
      title: '测试视频',
      candidates: [
        {
          value: 'https://cdn.example/video.mp4',
          source: 'video',
          visible: true,
          width: 800,
          height: 450,
        },
      ],
    })

    await service.openWindow({ url: 'https://www.douyin.com/video/1' })
    const inspection = await service.inspectMedia(undefined)
    expect(inspection).toMatchObject({
      pageUrl: 'https://www.douyin.com/video/1',
      title: '测试视频',
      candidates: [
        {
          url: 'https://cdn.example/video.mp4',
          source: 'video',
          kind: 'mp4',
          visible: true,
        },
      ],
    })

    let doneListener: ((event: unknown, state: string) => void) | null = null
    const item = {
      setSavePath: vi.fn(),
      once: vi.fn((_event: string, listener: (event: unknown, state: string) => void) => {
        doneListener = listener
      }),
      getSavePath: vi.fn(() => '/Users/test/Downloads/test-video.mp4'),
      getFilename: vi.fn(() => 'test-video.mp4'),
      getReceivedBytes: vi.fn(() => 456),
      cancel: vi.fn(),
    }
    fake.pageWebContents.downloadURL.mockImplementation(() => {
      fake.downloadListeners['will-download']?.({}, item)
      doneListener?.({}, 'completed')
    })

    const downloaded = await service.downloadMedia(
      undefined,
      'https://cdn.example/video.mp4',
      'test-video',
    )
    expect(fake.pageWebContents.downloadURL).toHaveBeenCalledWith('https://cdn.example/video.mp4', {
      headers: { Referer: 'https://example.com' },
    })
    expect(item.setSavePath).toHaveBeenCalledWith('/Users/test/Downloads/test-video.mp4')
    expect(downloaded).toEqual({
      path: '/Users/test/Downloads/test-video.mp4',
      filename: 'test-video.mp4',
      size: 456,
    })
  })

  it('拒绝未被当前页面检查结果确认的媒体地址', async () => {
    const fake = createFakeBrowserWindow()
    electronMocks.createWindow.mockReturnValue(fake.win)
    const service = new InternalBrowserService()

    await service.openWindow({ url: 'https://example.com' })

    await expect(
      service.downloadMedia(undefined, 'https://cdn.example/not-inspected.mp4', 'video'),
    ).rejects.toMatchObject({ code: 'INVALID_MEDIA_URL' })
    expect(fake.pageWebContents.downloadURL).not.toHaveBeenCalled()
  })
})
