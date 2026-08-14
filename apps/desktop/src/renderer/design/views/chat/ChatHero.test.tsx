// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('renders the celestial hero with greeting and actionable cards', async () => {
    const onSelectPrompt = vi.fn()

    await act(async () => {
      root.render(
        <SingleAgentEmptyHero themeId="celestial" onSelectPrompt={onSelectPrompt} />,
      )
    })

    const section = container.querySelector<HTMLElement>('.single-empty-hero')
    expect(section?.className).toContain('single-empty-hero-celestial')
    expect(section?.getAttribute('data-empty-theme')).toBe('celestial')
    expect(container.querySelector('.single-empty-eyebrow')?.textContent).toBe('SPARK WORKSPACE')
    // 标题随本地时间问候（小时不定，断言共同后缀）。
    expect(container.querySelector('.single-empty-title')?.textContent).toContain('，继续推进')

    const action = container.querySelector<HTMLButtonElement>('.single-empty-action')
    expect(action).not.toBeNull()
    act(() => action?.click())
    expect(onSelectPrompt).toHaveBeenCalled()

    // 主题切换器已随多主题下线移除。
    expect(container.querySelector('.empty-hero-theme-trigger')).toBeNull()
  })

  it('keeps only the banner (no action cards) in heatmap mode', async () => {
    await act(async () => {
      root.render(
        <SingleAgentEmptyHero themeId="celestial" onSelectPrompt={() => {}} hideActions />,
      )
    })

    expect(container.querySelector('.single-empty-action')).toBeNull()
    expect(container.querySelector('.single-empty-hero')?.className).toContain(
      'single-empty-hero--banner',
    )
  })
})
