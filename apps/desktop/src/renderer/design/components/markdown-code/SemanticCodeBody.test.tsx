// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SemanticCodeBody } from './SemanticCodeBody'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function render(jsx: React.ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(jsx)
  })
  return { container, root }
}

function collect(container: HTMLElement, selector: string) {
  return Array.from(container.querySelectorAll(selector))
}

describe('SemanticCodeBody — diff', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;({ container, root } = render(null))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders file headers without add/del classes', () => {
    act(() => {
      root.render(
        <SemanticCodeBody
          mode="diff"
          code={'--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new'}
        />,
      )
    })

    const fileOld = collect(container, '.md-code-diff-line--file-old')
    const fileNew = collect(container, '.md-code-diff-line--file-new')
    const adds = collect(container, '.md-code-diff-line--add')
    const dels = collect(container, '.md-code-diff-line--del')
    const hunks = collect(container, '.md-code-diff-line--hunk')

    expect(fileOld).toHaveLength(1)
    expect(fileNew).toHaveLength(1)
    expect(adds).toHaveLength(1)
    expect(dels).toHaveLength(1)
    expect(hunks).toHaveLength(1)
  })

  it('exposes the semantic mode on the data attribute', () => {
    act(() => {
      root.render(<SemanticCodeBody mode="diff" code={'+ added'} />)
    })
    expect(container.querySelector('[data-code-mode="diff"]')).not.toBeNull()
  })
})

describe('SemanticCodeBody — terminal', () => {
  it('marks command lines and tones', () => {
    const { container, root } = render(null)
    act(() => {
      root.render(
        <SemanticCodeBody
          mode="terminal"
          code={'$ ls\nREADME.md\nnpm ERR! failed'}
        />,
      )
    })

    expect(container.querySelector('.md-code-terminal-line--command')).not.toBeNull()
    expect(container.querySelector('.md-code-semantic-line--error')).not.toBeNull()

    act(() => root.unmount())
    container.remove()
  })
})

describe('SemanticCodeBody — log', () => {
  it('maps log levels to tones', () => {
    const { container, root } = render(null)
    act(() => {
      root.render(
        <SemanticCodeBody
          mode="log"
          code={'INFO ready\nERROR boom\nDEBUG trace'}
        />,
      )
    })

    expect(container.querySelector('.md-code-semantic-line--info')).not.toBeNull()
    expect(container.querySelector('.md-code-semantic-line--error')).not.toBeNull()
    expect(container.querySelector('.md-code-semantic-line--debug')).not.toBeNull()

    act(() => root.unmount())
    container.remove()
  })
})
