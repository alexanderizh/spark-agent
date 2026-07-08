// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SHORTCUTS, loadShortcuts, saveShortcuts } from '../design/hooks/useKeyboard'

describe('shortcut persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('uses F for the global palette and K for sidebar session search', () => {
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'openPalette')?.key).toBe('f')
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'search')?.key).toBe('k')
  })

  it('migrates the reversed defaults back to F palette and K session search', () => {
    localStorage.setItem(
      'spark-agent:shortcuts',
      JSON.stringify([
        { id: 'openPalette', key: 'k' },
        { id: 'search', key: 'f' },
      ]),
    )

    const shortcuts = loadShortcuts()

    expect(shortcuts.find((shortcut) => shortcut.id === 'openPalette')?.key).toBe('f')
    expect(shortcuts.find((shortcut) => shortcut.id === 'search')?.key).toBe('k')
  })

  it('preserves an explicit post-migration customization back to K palette and F search', () => {
    const custom = DEFAULT_SHORTCUTS.map((shortcut) => {
      if (shortcut.id === 'openPalette') return { ...shortcut, key: 'k' }
      if (shortcut.id === 'search') return { ...shortcut, key: 'f' }
      return shortcut
    })

    saveShortcuts(custom)

    const shortcuts = loadShortcuts()

    expect(shortcuts.find((shortcut) => shortcut.id === 'openPalette')?.key).toBe('k')
    expect(shortcuts.find((shortcut) => shortcut.id === 'search')?.key).toBe('f')
  })
})
