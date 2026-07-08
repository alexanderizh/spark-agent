import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}))

import {
  broadcastToAppWindows,
  registerAppWindow,
  sendToMainWindow,
  setMainWindow,
} from './index.js'

type FakeWindow = {
  webContents: { send: ReturnType<typeof vi.fn> }
  isDestroyed: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
}

function createWindow(destroyed = false): FakeWindow {
  return {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => destroyed),
    once: vi.fn(),
  }
}

describe('window stream routing', () => {
  it('keeps main-window sends scoped while broadcast reaches registered app windows', () => {
    const main = createWindow()
    const canvas = createWindow()
    const closed = createWindow(true)

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
  })
})
