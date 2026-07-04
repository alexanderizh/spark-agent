// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { patchAppearance, useAppearanceEffects } from './useAppearance'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function AppearanceEffectsHarness() {
  useAppearanceEffects()
  return null
}

describe('patchAppearance ui zoom', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let invoke: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke = vi.fn(() => Promise.resolve(undefined))
    vi.stubGlobal('spark', {
      invoke,
      on: vi.fn(() => vi.fn()),
    })
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
    document.documentElement.removeAttribute('style')
    document.body.removeAttribute('style')
    vi.unstubAllGlobals()
  })

  it('applies ui zoom through Electron and removes legacy CSS zoom styling', () => {
    document.documentElement.style.setProperty('--ui-zoom', '1.25')
    document.documentElement.style.setProperty('--ui-zoom-inverse', '0.8')
    document.documentElement.style.zoom = '1.25'
    document.body.style.zoom = '1.25'

    patchAppearance({ uiZoom: 150 })

    expect(invoke).toHaveBeenCalledWith('window:set-zoom', { zoomPercent: 150 })
    expect(document.documentElement.style.getPropertyValue('--ui-zoom')).toBe('')
    expect(document.documentElement.style.getPropertyValue('--ui-zoom-inverse')).toBe('')
    expect(document.documentElement.style.zoom).toBe('')
    expect(document.body.style.zoom).toBe('')
  })

  it('persists the absolute browser zoom reported by the main process', () => {
    act(() => {
      root = createRoot(container)
      root.render(React.createElement(AppearanceEffectsHarness))
    })
    invoke.mockClear()

    act(() => {
      window.dispatchEvent(new CustomEvent('spark:browser-zoom-changed', { detail: { zoomPercent: 105 } }))
    })

    expect(invoke).toHaveBeenCalledWith('window:set-zoom', { zoomPercent: 105 })
    expect(JSON.parse(localStorage.getItem('spark-settings-appearance') ?? '{}')).toMatchObject({
      uiZoom: 105,
    })
  })

  it('hydrates appearance settings from persisted IPC state on mount', async () => {
    invoke.mockImplementation((channel: string) => {
      if (channel === 'settings:get') {
        return Promise.resolve({
          value: {
            font: 'inter',
            fontSize: 16,
            uiZoom: 110,
          },
        })
      }
      return Promise.resolve(undefined)
    })

    await act(async () => {
      root = createRoot(container)
      root.render(React.createElement(AppearanceEffectsHarness))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(invoke).toHaveBeenCalledWith('settings:get', { category: 'appearance', key: 'data' })
    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('"Inter"')
    expect(document.documentElement.style.getPropertyValue('--font-base')).toBe('16px')
    expect(JSON.parse(localStorage.getItem('spark-settings-appearance') ?? '{}')).toMatchObject({
      font: 'inter',
      fontSize: 16,
      uiZoom: 110,
    })
  })

  it('falls back to Geist when the requested font is unavailable', () => {
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        check: vi.fn((query: string) => !query.includes('"Inter"')),
      },
    })

    patchAppearance({ font: 'inter' })

    expect(document.documentElement.style.getPropertyValue('--font-sans')).toContain('"Geist"')
    expect(document.documentElement.style.getPropertyValue('--font-sans')).not.toContain('"Inter",')
  })
})
