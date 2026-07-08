import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  default: {
    app: {
      on: vi.fn(),
    },
    BrowserWindow: vi.fn(),
    shell: {
      openExternal: vi.fn(),
    },
  },
  app: {
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  shell: {
    openExternal: vi.fn(),
  },
}))

import { CanvasWindowService } from '../CanvasWindowService.js'

type FakeWebContents = {
  send: ReturnType<typeof vi.fn>
  setWindowOpenHandler: ReturnType<typeof vi.fn>
}

type FakeWindow = {
  id: number
  webContents: FakeWebContents
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

function createFakeWindow(id: number): FakeWindow {
  return {
    id,
    webContents: {
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    },
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    show: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    once: vi.fn(),
    on: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
  }
}

function getWindowListener(win: FakeWindow, eventName: string): (...args: unknown[]) => void {
  const call = win.on.mock.calls.find(([event]) => event === eventName)
  if (!call || typeof call[1] !== 'function') throw new Error(`Missing ${eventName} listener`)
  return call[1] as (...args: unknown[]) => void
}

describe('CanvasWindowService', () => {
  it('creates one window and reuses it for later project opens', async () => {
    const created: FakeWindow[] = []
    const service = new CanvasWindowService({
      createWindow: () => {
        const win = createFakeWindow(created.length + 1)
        created.push(win)
        return win as never
      },
      getRendererUrl: () => 'http://127.0.0.1:5173',
      getRendererFile: () => '/app/out/renderer/index.html',
      isDev: true,
      openExternal: vi.fn(),
    })

    const first = await service.open({ projectId: 'canvas_project_1' })
    const second = await service.open({ projectId: 'canvas_project_2' })

    expect(created).toHaveLength(1)
    expect(first.windowId).toBe(second.windowId)
    expect(first.projectId).toBe('canvas_project_1')
    expect(second.projectId).toBe('canvas_project_2')
    expect(created[0]?.show).toHaveBeenCalledTimes(2)
    expect(created[0]?.focus).toHaveBeenCalledTimes(2)
    expect(created[0]?.loadURL).toHaveBeenLastCalledWith(
      'http://127.0.0.1:5173/?window=canvas&projectId=canvas_project_2',
    )
  })

  it('focuses without reloading when opening the active project again', async () => {
    const created: FakeWindow[] = []
    const service = new CanvasWindowService({
      createWindow: () => {
        const win = createFakeWindow(created.length + 1)
        created.push(win)
        return win as never
      },
      getRendererUrl: () => 'http://127.0.0.1:5173',
      getRendererFile: () => '/app/out/renderer/index.html',
      isDev: true,
      openExternal: vi.fn(),
    })

    await service.open({ projectId: 'canvas_project_1' })
    await service.open({ projectId: 'canvas_project_1' })

    expect(created).toHaveLength(1)
    expect(created[0]?.loadURL).toHaveBeenCalledTimes(1)
    expect(created[0]?.focus).toHaveBeenCalledTimes(2)
  })

  it('keeps the current project and raises a readable error when navigation is cancelled', async () => {
    const created: FakeWindow[] = []
    const service = new CanvasWindowService({
      createWindow: () => {
        const win = createFakeWindow(created.length + 1)
        created.push(win)
        return win as never
      },
      getRendererUrl: () => 'http://127.0.0.1:5173',
      getRendererFile: () => '/app/out/renderer/index.html',
      isDev: true,
      openExternal: vi.fn(),
    })

    await service.open({ projectId: 'canvas_project_1' })
    created[0]?.loadURL.mockRejectedValueOnce(
      new Error(
        "ERR_FAILED (-2) loading 'http://127.0.0.1:5173/?window=canvas&projectId=canvas_project_2'",
      ),
    )

    await expect(service.open({ projectId: 'canvas_project_2' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: '当前画布有未保存修改，请先保存或关闭当前画布后再打开其他画布。',
    })
    expect(service.getActiveProjectId()).toBe('canvas_project_1')
    expect(created[0]?.focus).toHaveBeenCalledTimes(2)
  })

  it('routes native close through the renderer guard before closing', async () => {
    const created: FakeWindow[] = []
    const service = new CanvasWindowService({
      createWindow: () => {
        const win = createFakeWindow(created.length + 1)
        created.push(win)
        return win as never
      },
      getRendererUrl: () => 'http://127.0.0.1:5173',
      getRendererFile: () => '/app/out/renderer/index.html',
      isDev: true,
      openExternal: vi.fn(),
    })

    await service.open({ projectId: 'canvas_project_1' })
    const preventDefault = vi.fn()
    getWindowListener(created[0]!, 'close')({ preventDefault })

    expect(preventDefault).toHaveBeenCalled()
    expect(created[0]?.webContents.send).toHaveBeenCalledWith(
      'stream:canvas-window:close-request',
      { projectId: 'canvas_project_1' },
    )

    expect(service.closeAfterRendererGuard()).toBe(true)
    expect(created[0]?.close).toHaveBeenCalledTimes(1)

    getWindowListener(created[0]!, 'close')({ preventDefault })
    expect(created[0]?.webContents.send).toHaveBeenCalledTimes(1)
  })
})
