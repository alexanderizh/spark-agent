import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fromWebContents: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: mocks.fromWebContents,
  },
}))

import { getWindowForIpcSender } from './window-controls.js'

describe('window controls', () => {
  it('prefers the BrowserWindow that owns the IPC sender', () => {
    const senderWindow = { id: 2 }
    const fallbackWindow = { id: 1 }
    const sender = { id: 'canvas-webcontents' }
    mocks.fromWebContents.mockReturnValue(senderWindow)

    const win = getWindowForIpcSender({ sender } as never, () => fallbackWindow as never)

    expect(mocks.fromWebContents).toHaveBeenCalledWith(sender)
    expect(win).toBe(senderWindow)
  })

  it('falls back to the main window when the sender is detached', () => {
    const fallbackWindow = { id: 1 }
    mocks.fromWebContents.mockReturnValue(null)

    const win = getWindowForIpcSender({ sender: {} } as never, () => fallbackWindow as never)

    expect(win).toBe(fallbackWindow)
  })
})
