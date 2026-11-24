import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendToMainWindow: vi.fn(),
}))

vi.mock('electron', () => ({
  default: {
    BrowserWindow: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}))

vi.mock('@spark/shared', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('../../app-shutdown.js', () => ({ registerAppShutdownCleanup: vi.fn() }))
vi.mock('../../windows/index.js', () => ({
  registerAppWindow: vi.fn(),
  sendToMainWindow: mocks.sendToMainWindow,
}))
vi.mock('../../window-chrome.js', () => ({ buildWindowChromeOptions: () => ({}) }))
vi.mock('../../ipc/typed-ipc.js', () => ({ typedIpcHandle: vi.fn() }))

import { RemoteControlWindowService } from '../RemoteControlWindowService.js'

type FakeWindow = {
  id: number
  webContents: { setWindowOpenHandler: ReturnType<typeof vi.fn> }
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  listeners: Map<string, (...args: unknown[]) => void>
}

function createFakeWindow(id: number): FakeWindow {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  return {
    id,
    webContents: { setWindowOpenHandler: vi.fn() },
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener)
    }),
    destroy: vi.fn(),
    listeners,
  }
}

function createService(createWindow: () => FakeWindow) {
  return new RemoteControlWindowService({
    createWindow: () => createWindow() as never,
    getRendererUrl: () => 'http://127.0.0.1:5173',
    getRendererFile: () => '/app/out/renderer/index.html',
    isDev: true,
  })
}

describe('RemoteControlWindowService', () => {
  it('publishes open and closed state transitions and exposes the latest snapshot', async () => {
    mocks.sendToMainWindow.mockClear()
    const win = createFakeWindow(7)
    const service = createService(() => win)

    await expect(service.open()).resolves.toEqual({ success: true, windowId: 7 })
    expect(service.getState()).toEqual({ open: true, revision: 1 })
    expect(mocks.sendToMainWindow).toHaveBeenNthCalledWith(
      1,
      'stream:remote-control:window-state',
      { open: true, revision: 1 },
    )

    win.listeners.get('closed')?.()

    expect(service.getState()).toEqual({ open: false, revision: 2 })
    expect(mocks.sendToMainWindow).toHaveBeenNthCalledWith(
      2,
      'stream:remote-control:window-state',
      { open: false, revision: 2 },
    )
  })

  it('does not publish an open state when loading the renderer fails', async () => {
    mocks.sendToMainWindow.mockClear()
    const win = createFakeWindow(8)
    win.loadURL.mockRejectedValueOnce(new Error('load failed'))
    const service = createService(() => win)

    await expect(service.open()).resolves.toEqual({ success: false })

    expect(service.getState()).toEqual({ open: false, revision: 0 })
    expect(mocks.sendToMainWindow).not.toHaveBeenCalled()
    expect(win.destroy).toHaveBeenCalledOnce()
  })

  it('ignores a delayed close event from a replaced window', async () => {
    mocks.sendToMainWindow.mockClear()
    const oldWindow = createFakeWindow(9)
    const newWindow = createFakeWindow(10)
    const windows = [oldWindow, newWindow]
    const service = createService(() => {
      const window = windows.shift()
      if (window == null) throw new Error('No fake window available')
      return window
    })

    await service.open()
    const oldWindowClosed = oldWindow.listeners.get('closed')
    service.close()
    await service.open()

    oldWindowClosed?.()

    expect(service.getState()).toEqual({ open: true, revision: 3 })
    expect(mocks.sendToMainWindow).toHaveBeenLastCalledWith(
      'stream:remote-control:window-state',
      { open: true, revision: 3 },
    )
  })
})
