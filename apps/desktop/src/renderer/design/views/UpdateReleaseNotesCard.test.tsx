// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@lobehub/ui', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick(): void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))
vi.mock('../Icons', () => ({ Icons: { Sparkles: () => <span /> } }))
vi.mock('./chat/ChatMarkdown', () => ({
  MarkdownText: ({ content }: { content: string }) => <div>{content}</div>,
}))

import { UpdateReleaseNotesCard } from './UpdateReleaseNotesCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('UpdateReleaseNotesCard', () => {
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

  it('does not render when the update has no release notes', () => {
    act(() => root.render(<UpdateReleaseNotesCard version="1.2.0" releaseNotes="  " />))
    expect(container.textContent).toBe('')
  })

  it('shows version metadata and release notes', () => {
    act(() => root.render(
      <UpdateReleaseNotesCard
        version="1.2.0"
        releaseDate="2026-09-07T00:00:00.000Z"
        releaseNotes="- 修复更新说明展示"
      />,
    ))
    expect(container.textContent).toContain('v1.2.0')
    expect(container.textContent).toContain('修复更新说明展示')
  })

  it('offers expansion for long release notes', () => {
    act(() => root.render(<UpdateReleaseNotesCard version="1.2.0" releaseNotes={'x'.repeat(1_201)} />))
    const button = container.querySelector('button')
    expect(button?.textContent).toBe('展开完整更新内容')
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(button?.textContent).toBe('收起更新内容')
  })
})
