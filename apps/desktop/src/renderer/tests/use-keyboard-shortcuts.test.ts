// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_SHORTCUTS,
  isMonacoEditorTarget,
  loadShortcuts,
  saveShortcuts,
} from '../design/hooks/useKeyboard'

describe('shortcut persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('uses F for the global palette and K for sidebar session search', () => {
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'openPalette')?.key).toBe('f')
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'search')?.key).toBe('k')
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'openFileSearch')).toMatchObject({
      key: 'p',
      shift: false,
    })
    expect(DEFAULT_SHORTCUTS.find((shortcut) => shortcut.id === 'openContentSearch')).toMatchObject(
      {
        key: 'f',
        shift: true,
      },
    )
  })

  it('recognizes Monaco descendants so Cmd/Ctrl+F can remain editor-local', () => {
    const editor = document.createElement('div')
    editor.className = 'monaco-editor'
    const textarea = document.createElement('textarea')
    editor.append(textarea)
    document.body.append(editor)

    expect(isMonacoEditorTarget(textarea)).toBe(true)
    expect(isMonacoEditorTarget(document.body)).toBe(false)
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
