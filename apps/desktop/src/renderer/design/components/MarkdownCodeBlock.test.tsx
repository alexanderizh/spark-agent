// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./markdown-code/SemanticCodeBody', () => ({
  SemanticCodeBody: ({ code, mode }: { code: string; mode: string }) => (
    <pre data-code-mode={mode} data-testid="semantic-body">
      {code}
    </pre>
  ),
}))

vi.mock('../Icons', () => ({
  Icons: {
    Spinner: () => <span data-testid="spinner" />,
    Check: () => <span data-testid="check" />,
    Copy: () => <span data-testid="copy" />,
  },
}))

vi.mock('../hooks/useResolvedTheme', () => ({
  useResolvedTheme: () => 'light' as const,
}))

import { MarkdownCodeBlock } from './MarkdownCodeBlock'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function renderBlock(props: Partial<React.ComponentProps<typeof MarkdownCodeBlock>> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      <MarkdownCodeBlock
        code={props.code ?? 'echo hello'}
        lang={props.lang ?? ''}
        syntaxHighlight={props.syntaxHighlight ?? true}
        incomplete={props.incomplete ?? false}
      />,
    )
  })
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

describe('MarkdownCodeBlock', () => {
  let container: HTMLDivElement
  let unmount: () => void

  beforeEach(() => {
    ;({ container, unmount } = renderBlock())
  })

  afterEach(() => {
    unmount()
  })

  it('renders diff fences as semantic bodies', async () => {
    unmount()
    ;({ container, unmount } = renderBlock({
      lang: 'diff',
      code: '--- a/x\n+++ b/x\n@@\n-a\n+b',
    }))
    expect(container.querySelector('[data-code-mode="diff"]')).not.toBeNull()
  })

  it('renders terminal fences as semantic bodies', async () => {
    unmount()
    ;({ container, unmount } = renderBlock({
      lang: 'console',
      code: '$ ls\nfile',
    }))
    expect(container.querySelector('[data-code-mode="terminal"]')).not.toBeNull()
  })

  it('renders log fences as semantic bodies', async () => {
    unmount()
    ;({ container, unmount } = renderBlock({
      lang: 'log',
      code: 'INFO ready',
    }))
    expect(container.querySelector('[data-code-mode="log"]')).not.toBeNull()
  })

  it('does not enter semantic mode for plain source', async () => {
    unmount()
    ;({ container, unmount } = renderBlock({
      lang: 'ts',
      code: 'const x = 1',
    }))
    expect(container.querySelector('[data-code-mode]')).toBeNull()
  })

  it('does not enter semantic mode for incomplete fences', async () => {
    unmount()
    ;({ container, unmount } = renderBlock({
      lang: 'diff',
      code: '+ a',
      incomplete: true,
    }))
    expect(container.querySelector('[data-code-mode]')).toBeNull()
  })

  it('does not enter semantic mode when syntax highlight is disabled', async () => {
    unmount()
    ;({ container, unmount } = renderBlock({
      lang: 'diff',
      code: '+ a',
      syntaxHighlight: false,
    }))
    expect(container.querySelector('[data-code-mode]')).toBeNull()
  })

  it('keeps the macOS traffic header visible for diff fences', () => {
    unmount()
    ;({ container, unmount } = renderBlock({
      lang: 'diff',
      code: '--- a/x\n+++ b/x\n-a\n+b',
    }))
    expect(container.querySelector('.md-code-traffic')).not.toBeNull()
    expect(container.querySelector('.md-code-lang')?.textContent).toBe('diff')
  })
})
