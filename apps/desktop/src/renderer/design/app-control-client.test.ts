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
          prefillComposer: vi.fn(async () => false),
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
          prefillComposer: vi.fn(async () => false),
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
          prefillComposer: vi.fn(async () => false),
          waitForRender: async () => undefined,
        },
      ),
    ).resolves.toBe('rejected')
    expect(setView).not.toHaveBeenCalled()
  })

  it('prefills an empty composer without submitting or accepting a rejected draft write', async () => {
    const setView = vi.fn()
    const prefillComposer = vi.fn(async () => true)
    await expect(
      applyAppControlCommand(
        { name: 'prefill_composer', text: 'Review this change' },
        {
          hasDialogOpen: false,
          setTheme: vi.fn(),
          setView,
          currentView: () => 'chat',
          prefillComposer,
          waitForRender: async () => undefined,
        },
      ),
    ).resolves.toBe('applied')
    expect(setView).toHaveBeenCalledWith('chat')
    expect(prefillComposer).toHaveBeenCalledWith('Review this change')

    prefillComposer.mockResolvedValue(false)
    await expect(
      applyAppControlCommand(
        { name: 'prefill_composer', text: 'Do not overwrite' },
        {
          hasDialogOpen: false,
          setTheme: vi.fn(),
          setView,
          currentView: () => 'chat',
          prefillComposer,
          waitForRender: async () => undefined,
        },
      ),
    ).resolves.toBe('rejected')
  })
})
