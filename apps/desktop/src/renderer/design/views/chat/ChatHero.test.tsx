// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SingleAgentEmptyHero } from './ChatHero'

vi.mock('antd', () => ({
  Dropdown: ({
    children,
    popupRender,
  }: {
    children: React.ReactNode
    popupRender?: () => React.ReactNode
  }) => (
    <>
      {children}
      {popupRender?.()}
    </>
  ),
}))
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

  it('shows the current theme beside the title and switches from the quick menu', async () => {
    const onSelectTheme = vi.fn()

    await act(async () => {
      root.render(
        <SingleAgentEmptyHero
          themeId="none"
          onSelectPrompt={() => {}}
          onSelectTheme={onSelectTheme}
        />,
      )
    })

    expect(
      container.querySelector<HTMLButtonElement>('.empty-hero-theme-trigger')?.textContent,
    ).toContain('主题·经典')

    const midnightButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    ).find((button) => button.textContent?.includes('午夜星港'))

    act(() => midnightButton?.click())

    expect(onSelectTheme).toHaveBeenCalledWith('midnight')
  })
})
