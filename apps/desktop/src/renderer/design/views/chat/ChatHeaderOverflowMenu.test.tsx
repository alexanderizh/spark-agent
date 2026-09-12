// @vitest-environment jsdom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Clock3 } from 'lucide-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ChatToolbar', () => ({
  TabbarIcon: ({ icon: Icon }: { icon: React.ComponentType<{ size?: number }> }) => (
    <Icon size={14} />
  ),
  TabbarTooltipButton: ({
    children,
    ariaLabel,
    className,
    onClick,
  }: {
    children: React.ReactNode
    ariaLabel?: string
    className?: string
    onClick?: () => void
  }) => (
    <button type="button" aria-label={ariaLabel} className={className} onClick={onClick}>
      {children}
    </button>
  ),
}))

import { ChatHeaderOverflowMenu } from './ChatHeaderOverflowMenu'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ChatHeaderOverflowMenu', () => {
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

  it('runs a selected action and closes the menu', () => {
    const onSelect = vi.fn()
    act(() => {
      root.render(
        <ChatHeaderOverflowMenu
          items={[{ id: 'schedule', label: '计划任务', icon: Clock3, onSelect }]}
        />,
      )
    })

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')?.click())
    const item = container.querySelector<HTMLButtonElement>('[role="menuitem"]')
    expect(item?.textContent).toContain('计划任务')

    act(() => item?.click())
    expect(onSelect).toHaveBeenCalledOnce()
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })

  it('closes when Escape is pressed', () => {
    act(() => {
      root.render(
        <ChatHeaderOverflowMenu
          items={[{ id: 'schedule', label: '计划任务', icon: Clock3, onSelect: vi.fn() }]}
        />,
      )
    })
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')?.click())
    expect(container.querySelector('[role="menu"]')).not.toBeNull()

    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })
})
