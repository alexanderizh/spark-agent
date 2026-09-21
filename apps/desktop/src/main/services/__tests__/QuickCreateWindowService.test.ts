import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  default: {
    BrowserWindow: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}))

vi.mock('../../windows/index.js', () => ({
  registerAppWindow: vi.fn(),
}))

import { QuickCreateWindowService } from '../QuickCreateWindowService.js'

type FakeWindow = {
  id: number
  webContents: {
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

function createFakeWindow(id: number): FakeWindow {
  return {
    id,
    webContents: {
      setWindowOpenHandler: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    destroy: vi.fn(),
  }
}

describe('QuickCreateWindowService', () => {
  it('opens the standalone renderer and reuses the same window', async () => {
    const created: FakeWindow[] = []
    const service = new QuickCreateWindowService({
      createWindow: () => {
        const win = createFakeWindow(created.length + 1)
        created.push(win)
        return win as never
      },
      getRendererUrl: () => 'http://127.0.0.1:5173',
      getRendererFile: () => '/app/out/renderer/index.html',
      isDev: true,
    })

    const first = await service.open()
    const second = await service.open()

    expect(created).toHaveLength(1)
    expect(first).toEqual({ success: true, windowId: 1 })
    expect(second).toEqual({ success: true, windowId: 1 })
    expect(created[0]?.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/?window=quick-create')
    expect(created[0]?.show).toHaveBeenCalledTimes(2)
    expect(created[0]?.focus).toHaveBeenCalledTimes(2)
  })

  it('clears the window reference after close and opens a new one next time', async () => {
    const created: FakeWindow[] = []
    const service = new QuickCreateWindowService({
      createWindow: () => {
        const win = createFakeWindow(created.length + 1)
        created.push(win)
        return win as never
      },
      getRendererUrl: () => 'http://127.0.0.1:5173',
      getRendererFile: () => '/app/out/renderer/index.html',
      isDev: true,
    })

    await service.open()
    const closedListener = created[0]?.on.mock.calls.find(([event]) => event === 'closed')?.[1] as
      | (() => void)
      | undefined
    closedListener?.()
    await service.open()

    expect(created).toHaveLength(2)
  })

  it('returns failure and destroys the window when renderer loading fails', async () => {
    const created: FakeWindow[] = []
    const service = new QuickCreateWindowService({
      createWindow: () => {
        const win = createFakeWindow(created.length + 1)
        win.loadURL.mockRejectedValueOnce(new Error('load failed'))
        created.push(win)
        return win as never
      },
      getRendererUrl: () => 'http://127.0.0.1:5173',
      getRendererFile: () => '/app/out/renderer/index.html',
      isDev: true,
    })

    await expect(service.open()).resolves.toEqual({ success: false })
    expect(created[0]?.destroy).toHaveBeenCalled()
    expect(service.getWindow()).toBeNull()
  })
})
