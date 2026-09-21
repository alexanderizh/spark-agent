// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SingleAgentEmptyHero } from './ChatHero'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SingleAgentEmptyHero', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders the celestial greeting banner only', async () => {
    await act(async () => {
      root.render(<SingleAgentEmptyHero themeId="celestial" />)
    })

    const section = container.querySelector<HTMLElement>('.single-empty-hero')
    expect(section?.className).toContain('single-empty-hero-celestial')
    expect(section?.getAttribute('data-empty-theme')).toBe('celestial')
    expect(container.querySelector('.single-empty-eyebrow')?.textContent).toBe('SPARK WORKSPACE')
    // 标题随本地时间问候（小时不定，断言共同后缀）。
    expect(container.querySelector('.single-empty-title')?.textContent).toContain('，继续推进')

    // 主题切换器已随多主题下线移除。
    expect(container.querySelector('.empty-hero-theme-trigger')).toBeNull()
  })

  it('no longer renders the quick-action card group (empty session is heatmap-only)', async () => {
    await act(async () => {
      root.render(<SingleAgentEmptyHero themeId="celestial" />)
    })

    expect(container.querySelector('.single-empty-actions')).toBeNull()
    expect(container.querySelector('.single-empty-action')).toBeNull()
    expect(container.querySelectorAll('button').length).toBe(0)
  })
})
