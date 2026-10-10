// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkinBackdrop } from './SkinBackdrop'
import type { AppSkinId } from './skinRegistry'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SkinBackdrop', () => {
  let container: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    if (root != null) {
      act(() => {
        root?.unmount()
      })
      root = null
    }
    container.remove()
  })

  function renderBackdrop(skinId: AppSkinId, resolvedTheme: 'light' | 'dark') {
    act(() => {
      const nextRoot = createRoot(container)
      nextRoot.render(<SkinBackdrop skinId={skinId} resolvedTheme={resolvedTheme} />)
      // 必须记到外层 root，否则 afterEach 的 unmount 抓不到实例、React root 会泄漏。
      root = nextRoot
    })
  }

  it('renders nothing at all for the no-skin option', () => {
    renderBackdrop('none', 'light')
    expect(container.querySelector('.app-skin')).toBeNull()
    expect(container.querySelector('.app-skin-backdrop')).toBeNull()
  })

  it('paints the light artwork and the light scrim strength in light mode', () => {
    renderBackdrop('verdant', 'light')
    const backdrop = container.querySelector<HTMLElement>('.app-skin-backdrop')
    const scrim = container.querySelector<HTMLElement>('.app-skin-scrim')
    expect(backdrop?.style.backgroundImage).toContain('/skins/verdant-light.webp')
    expect(scrim?.style.opacity).toBe('0.18')
  })

  it('switches to the dark artwork and the dark scrim strength in dark mode', () => {
    renderBackdrop('verdant', 'dark')
    const backdrop = container.querySelector<HTMLElement>('.app-skin-backdrop')
    const scrim = container.querySelector<HTMLElement>('.app-skin-scrim')
    expect(backdrop?.style.backgroundImage).toContain('/skins/verdant-dark.webp')
    expect(scrim?.style.opacity).toBe('0.34')
  })

  it('marks the layer decorative so screen readers skip the artwork', () => {
    renderBackdrop('deepspace', 'light')
    expect(container.querySelector('.app-skin')?.getAttribute('aria-hidden')).toBe('true')
    expect(
      container.querySelector<HTMLElement>('.app-skin-backdrop')?.style.backgroundImage,
    ).toContain('/skins/deepspace-light.webp')
  })
})
