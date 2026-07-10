// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const markdownMocks = vi.hoisted(() => ({
  parseMarkdown: vi.fn((content: string) => [{ kind: 'paragraph' as const, text: content }]),
}))

vi.mock('./ChatMarkdownUtils', () => ({
  parseMarkdown: markdownMocks.parseMarkdown,
}))

vi.mock('../../hooks/useAppearance', () => ({
  readAppearance: () => ({ syntaxHighlight: true }),
  useAppearanceSettings: () => ({ syntaxHighlight: true }),
}))

vi.mock('../../components/MarkdownCodeBlock', () => ({
  MarkdownCodeBlock: ({ code }: { code: string }) => <pre>{code}</pre>,
}))

vi.mock('../../components/MarkdownImage', () => ({
  MarkdownImage: ({ src }: { src: string }) => <img src={src} alt="" />,
}))

vi.mock('../../components/ClickableFilePath', () => ({
  ClickableFilePath: ({ path }: { path: string }) => <span>{path}</span>,
  ClickableUrl: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
  extractFilePaths: () => [],
  extractUrlsAndEmails: () => [],
}))

vi.mock('../../components/FileDisplay', () => ({
  isLocalFileReference: () => false,
  isPreviewableFileReference: () => false,
  normalizeFileReference: (value: string) => value,
}))

vi.mock('./ChatDocumentOutput', () => ({
  renderDocumentOutputParagraph: () => null,
}))

import { MarkdownText } from './ChatMarkdown'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('MarkdownText', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    markdownMocks.parseMarkdown.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('does not reparse stable content when its parent rerenders', () => {
    const render = (label: string) => (
      <section data-label={label}>
        <MarkdownText content="stable markdown" />
      </section>
    )

    act(() => root.render(render('first')))
    act(() => root.render(render('second')))

    expect(markdownMocks.parseMarkdown).toHaveBeenCalledTimes(1)
    expect(container.textContent).toBe('stable markdown')
  })

  it('reparses streaming markdown whenever the content changes', () => {
    act(() => root.render(<MarkdownText content="partial" isStreaming />))
    act(() => root.render(<MarkdownText content="partial response" isStreaming />))

    expect(markdownMocks.parseMarkdown).toHaveBeenCalledTimes(2)
    expect(markdownMocks.parseMarkdown).toHaveBeenLastCalledWith('partial response')
    expect(container.textContent).toBe('partial response')
  })
})
