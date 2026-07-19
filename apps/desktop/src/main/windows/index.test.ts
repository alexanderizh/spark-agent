import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))

import {
  broadcastToAppWindows,
  getLastFocusedAppWindow,
  getPreferredAppWindow,
  registerAppWindow,
  revealAppWindow,
  sendToMainWindow,
  setMainWindow,
} from './index.js'

type FakeWindow = {
  webContents: { send: ReturnType<typeof vi.fn> }
  isDestroyed: ReturnType<typeof vi.fn>
  isMinimized: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  emit: (event: string) => void
}

function createWindow(options: { destroyed?: boolean; minimized?: boolean; visible?: boolean } = {}): FakeWindow {
  const listeners = new Map<string, Array<() => void>>()
  const addListener = (event: string, listener: () => void) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener])
  }
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => options.destroyed ?? false),
    isMinimized: vi.fn(() => options.minimized ?? false),
    isVisible: vi.fn(() => options.visible ?? true),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    on: vi.fn(addListener),
    once: vi.fn(addListener),
    emit: (event) => {
      for (const listener of listeners.get(event) ?? []) listener()
    },
  }
}

describe('window stream routing', () => {
  it('keeps main-window sends scoped while broadcast reaches registered app windows', () => {
    const main = createWindow()
    const canvas = createWindow()
    const closed = createWindow({ destroyed: true })

    setMainWindow(main as never)
    registerAppWindow(canvas as never)
    registerAppWindow(closed as never)

    sendToMainWindow('stream:test', { mode: 'main' })
    broadcastToAppWindows('stream:test', { mode: 'broadcast' })

    expect(main.webContents.send).toHaveBeenNthCalledWith(1, 'stream:test', { mode: 'main' })
    expect(main.webContents.send).toHaveBeenNthCalledWith(2, 'stream:test', {
      mode: 'broadcast',
    })
    expect(canvas.webContents.send).toHaveBeenCalledWith('stream:test', { mode: 'broadcast' })
    expect(closed.webContents.send).not.toHaveBeenCalled()

    main.emit('closed')
    canvas.emit('closed')
    closed.emit('closed')
  })

  it('tracks the most recently focused registered window and falls back to main', () => {
    const main = createWindow()
    const canvas = createWindow()

    setMainWindow(main as never)
    registerAppWindow(canvas as never)

    main.emit('focus')
    expect(getLastFocusedAppWindow()).toBe(main)
    expect(getPreferredAppWindow()).toBe(main)

    canvas.emit('focus')
    expect(getLastFocusedAppWindow()).toBe(canvas)
    expect(getPreferredAppWindow()).toBe(canvas)

    canvas.emit('closed')
    expect(getLastFocusedAppWindow()).toBeNull()
    expect(getPreferredAppWindow()).toBe(main)

    main.emit('closed')
  })

  it('restores, shows, and focuses a minimized hidden window', () => {
    const win = createWindow({ minimized: true, visible: false })

    expect(revealAppWindow(win as never)).toBe(true)
    expect(win.restore).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
  })

  it('does not reveal a destroyed window', () => {
    const win = createWindow({ destroyed: true, visible: false })

    expect(revealAppWindow(win as never)).toBe(false)
    expect(win.restore).not.toHaveBeenCalled()
    expect(win.show).not.toHaveBeenCalled()
    expect(win.focus).not.toHaveBeenCalled()
  })
})
