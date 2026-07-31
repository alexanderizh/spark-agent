import { describe, expect, it, vi } from 'vitest'
import { applyAppControlCommand } from './app-control-client'

describe('applyAppControlCommand', () => {
  it('applies only allowlisted typed commands', async () => {
    const setTheme = vi.fn()
    await expect(
      applyAppControlCommand(
        { name: 'set_theme', theme: 'dark' },
        {
          hasDialogOpen: false,
          setTheme,
          setView: vi.fn(),
          currentView: () => 'chat',
          waitForRender: async () => undefined,
        },
      ),
    ).resolves.toBe('applied')
    expect(setTheme).toHaveBeenCalledWith('dark')
  })

  it('rejects navigation when an unsaved-state guard keeps the current view', async () => {
    await expect(
      applyAppControlCommand(
        { name: 'navigate', view: 'settings' },
        {
          hasDialogOpen: false,
          setTheme: vi.fn(),
          setView: vi.fn(),
          currentView: () => 'chat',
          waitForRender: async () => undefined,
        },
      ),
    ).resolves.toBe('rejected')
  })

  it('rejects all commands while a modal dialog is authoritative', async () => {
    const setView = vi.fn()
    await expect(
      applyAppControlCommand(
        { name: 'navigate', view: 'settings' },
        {
          hasDialogOpen: true,
          setTheme: vi.fn(),
          setView,
          currentView: () => 'chat',
          waitForRender: async () => undefined,
        },
      ),
    ).resolves.toBe('rejected')
    expect(setView).not.toHaveBeenCalled()
  })
})
