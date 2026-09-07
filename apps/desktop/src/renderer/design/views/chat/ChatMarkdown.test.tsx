// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockMarkdownBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; code: string }
  | {
      kind: 'list'
      ordered: true
      start: number
      items: Array<{ text: string; checked?: boolean }>
    }

const markdownMocks = vi.hoisted(() => ({
  parseMarkdown: vi.fn((content: string): MockMarkdownBlock[] => [
    { kind: 'paragraph', text: content },
  ]),
}))

const documentOutputMocks = vi.hoisted(() => ({
  renderDocumentOutputParagraph: vi.fn(() => null),
}))

const diagramMocks = vi.hoisted(() => ({
  RenderDiagramBlock: vi.fn(
    ({ block }: { block: { source: string; diagramType: string } }) => (
      <div data-diagram-type={block.diagramType}>{block.source}</div>
    ),
  ),
}))

vi.mock('./ChatMarkdownUtils', () => ({
  parseMarkdown: markdownMocks.parseMarkdown,
  findStableMarkdownPrefixEnd: (content: string) => {
    const boundary = content.lastIndexOf('\n\n')
    return boundary < 0 ? 0 : boundary + 2
  },
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
  ClickableUrl: ({ url, label }: { url: string; label?: string }) => (
    <a href={url}>{label ?? url}</a>
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
  collectDocumentOutputKeys: () => [],
  renderDocumentOutputParagraph: documentOutputMocks.renderDocumentOutputParagraph,
}))

vi.mock('./RenderDiagramBlock', () => diagramMocks)

import { MarkdownText } from './ChatMarkdown'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('MarkdownText', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    markdownMocks.parseMarkdown.mockClear()
    documentOutputMocks.renderDocumentOutputParagraph.mockClear()
    diagramMocks.RenderDiagramBlock.mockClear()
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

  it('keeps completed streaming paragraphs parsed while only reparsing the live tail', () => {
    act(() => root.render(<MarkdownText content={'stable paragraph\n\npartial'} isStreaming />))
    act(() =>
      root.render(<MarkdownText content={'stable paragraph\n\npartial response'} isStreaming />),
    )

    expect(markdownMocks.parseMarkdown).toHaveBeenCalledTimes(3)
    expect(markdownMocks.parseMarkdown.mock.calls.map(([content]) => content)).toEqual([
      'stable paragraph\n\n',
      'partial',
      'partial response',
    ])
    expect(container.textContent).toBe('stable paragraphpartial response')
  })

  it('uses the original start for an ordered list block', () => {
    markdownMocks.parseMarkdown.mockReturnValueOnce([
      {
        kind: 'list',
        ordered: true,
        start: 2,
        items: [{ text: 'second item' }],
      },
    ])

    act(() => root.render(<MarkdownText content="2. second item" />))

    expect(container.querySelector('ol')?.getAttribute('start')).toBe('2')
  })

  it.each(['mermaid', 'MMD'])('renders %s fences as diagram blocks', (lang) => {
    markdownMocks.parseMarkdown.mockReturnValueOnce([
      { kind: 'code', lang, code: 'flowchart TD\n  A --> B' },
    ])

    act(() => root.render(<MarkdownText content={`\`\`\`${lang}\nflowchart TD\n  A --> B\n\`\`\``} />))

    expect(diagramMocks.RenderDiagramBlock.mock.calls[0]?.[0]).toMatchObject(
      expect.objectContaining({
        block: expect.objectContaining({
          diagramType: 'mermaid',
          source: 'flowchart TD\n  A --> B',
          status: 'rendered',
        }),
      }),
    )
    expect(container.querySelector('[data-diagram-type="mermaid"]')?.textContent).toBe(
      'flowchart TD\n  A --> B',
    )
  })

  it('keeps non-Mermaid fences as regular code blocks', () => {
    markdownMocks.parseMarkdown.mockReturnValueOnce([
      { kind: 'code', lang: 'typescript', code: 'const value = 1' },
    ])

    act(() => root.render(<MarkdownText content={'```typescript\nconst value = 1\n```'} />))

    expect(diagramMocks.RenderDiagramBlock).not.toHaveBeenCalled()
    expect(container.querySelector('pre')?.textContent).toBe('const value = 1')
  })

  it('keeps user text ending in a document extension as plain markdown', () => {
    act(() =>
      root.render(
        <MarkdownText
          content="符合一下方案真实性，就叫缓存命中优化.md"
          detectDocumentOutput={false}
        />,
      ),
    )

    expect(documentOutputMocks.renderDocumentOutputParagraph).not.toHaveBeenCalled()
    expect(container.textContent).toBe('符合一下方案真实性，就叫缓存命中优化.md')
  })

  it('detects document output by default for agent content', () => {
    act(() => root.render(<MarkdownText content="todo/缓存命中优化.md" />))

    expect(documentOutputMocks.renderDocumentOutputParagraph).toHaveBeenCalledTimes(1)
  })
})
