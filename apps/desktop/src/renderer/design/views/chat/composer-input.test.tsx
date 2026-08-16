// @vitest-environment jsdom

import { act, createRef } from 'react'
import { createRoot as createReactRoot, type Root } from 'react-dom/client'
import { $createParagraphNode, $getRoot, createEditor } from 'lexical'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ComposerLexicalInput,
  ComposerTokenNode,
  type ComposerLexicalInputHandle,
} from './ComposerLexicalInput'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  })
}

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

function createTextPasteEvent(text: string): Event {
  const globals = globalThis as typeof globalThis & {
    ClipboardEvent?: typeof Event
    DragEvent?: typeof Event
  }
  if (globals.DragEvent == null) {
    Object.defineProperty(globals, 'DragEvent', {
      configurable: true,
      value: class DragEvent extends Event {},
    })
  }
  if (globals.ClipboardEvent == null) {
    Object.defineProperty(globals, 'ClipboardEvent', {
      configurable: true,
      value: class ClipboardEvent extends Event {},
    })
  }
  const event = new globals.ClipboardEvent('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      files: [],
      items: [],
      types: ['text/plain'],
      getData: (format: string) => (format === 'text/plain' ? text : ''),
    },
  })
  return event
}

function setDomCaret(node: Text): void {
  const selection = document.getSelection()
  const range = document.createRange()
  range.setStart(node, node.length)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

afterEach(async () => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop()!
    await act(async () => mounted.root.unmount())
    mounted.container.remove()
  }
  document.getSelection()?.removeAllRanges()
})

describe('ComposerLexicalInput', () => {
  it('renders known commands and skills as tokens in one editable surface', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createReactRoot(container)
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(
        <ComposerLexicalInput
          initialValue="请执行 /review 并使用 @react"
          commandNames={['review']}
          skillNames={['react']}
          onChange={vi.fn()}
        />,
      )
    })

    const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(editor).not.toBeNull()
    expect(editor?.textContent).toBe('请执行 /review 并使用 @react')
    expect(editor?.querySelectorAll('[data-composer-token-kind="command"]')).toHaveLength(1)
    expect(editor?.querySelectorAll('[data-composer-token-kind="skill"]')).toHaveLength(1)
    expect(container.querySelector('.composer-input-highlights')).toBeNull()
  })

  it('keeps unknown command-like and skill-like text as ordinary text', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createReactRoot(container)
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(
        <ComposerLexicalInput
          initialValue="/unknown @missing /review @react"
          commandNames={['review']}
          skillNames={['react']}
          onChange={vi.fn()}
        />,
      )
    })

    const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(editor?.textContent).toBe('/unknown @missing /review @react')
    expect(editor?.querySelectorAll('[data-composer-token-kind="command"]')).toHaveLength(1)
    expect(editor?.querySelectorAll('[data-composer-token-kind="skill"]')).toHaveLength(1)
    expect(editor?.querySelector('[data-composer-token-kind="command"]')?.textContent).toBe(
      '/review',
    )
    expect(editor?.querySelector('[data-composer-token-kind="skill"]')?.textContent).toBe('@react')
  })

  it('hydrates a restored draft after mount and re-tokenizes its value', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createReactRoot(container)
    const inputRef = createRef<ComposerLexicalInputHandle>()
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(
        <ComposerLexicalInput
          ref={inputRef}
          value=""
          commandNames={['review']}
          skillNames={['react']}
          onChange={vi.fn()}
        />,
      )
    })

    await act(async () => {
      root.render(
        <ComposerLexicalInput
          ref={inputRef}
          value="restored /review @react"
          commandNames={['review']}
          skillNames={['react']}
          onChange={vi.fn()}
        />,
      )
    })

    const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(inputRef.current?.getValue()).toBe('restored /review @react')
    expect(editor?.querySelectorAll('[data-composer-token-kind="command"]')).toHaveLength(1)
    expect(editor?.querySelectorAll('[data-composer-token-kind="skill"]')).toHaveLength(1)
  })

  it('places the caret at the end when an external prefill replaces an empty focused value', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createReactRoot(container)
    const inputRef = createRef<ComposerLexicalInputHandle>()
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(
        <ComposerLexicalInput
          ref={inputRef}
          value=""
          commandNames={['review']}
          onChange={vi.fn()}
        />,
      )
    })

    await act(async () => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(0, 0)
      root.render(
        <ComposerLexicalInput
          ref={inputRef}
          value="prefilled /review"
          commandNames={['review']}
          onChange={vi.fn()}
        />,
      )
    })

    expect(inputRef.current?.getValue()).toBe('prefilled /review')
    expect(inputRef.current?.getSelection()).toEqual({ start: 17, end: 17 })
  })

  it('configures tokens as indivisible Lexical text nodes', () => {
    const editor = createEditor({
      namespace: 'ComposerLexicalInputTest',
      nodes: [ComposerTokenNode],
      onError: (error) => {
        throw error
      },
    })

    editor.update(() => {
      const token = new ComposerTokenNode('/review', 'command')
      const paragraph = $createParagraphNode()
      paragraph.append(token)
      $getRoot().append(paragraph)

      expect(token.getMode()).toBe('token')
      expect(token.canInsertTextBefore()).toBe(false)
      expect(token.canInsertTextAfter()).toBe(false)
    })
  })

  it('maps public selections to Lexical text nodes before replacing selected text', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createReactRoot(container)
    const inputRef = createRef<ComposerLexicalInputHandle>()
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(
        <ComposerLexicalInput
          ref={inputRef}
          initialValue="hello /review"
          commandNames={['review']}
          onChange={vi.fn()}
        />,
      )
    })

    await act(async () => {
      inputRef.current?.setSelectionRange(0, 5)
      inputRef.current?.replaceSelection('hi')
    })

    expect(inputRef.current?.getValue()).toBe('hi /review')
  })

  it('inserts plain text from a paste event without losing the current selection', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createReactRoot(container)
    const inputRef = createRef<ComposerLexicalInputHandle>()
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(<ComposerLexicalInput ref={inputRef} initialValue="hello" onChange={vi.fn()} />)
    })

    const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(editor).not.toBeNull()

    await act(async () => {
      inputRef.current?.setSelectionRange(5, 5)
      editor?.dispatchEvent(createTextPasteEvent(' world'))
      await Promise.resolve()
    })

    expect(inputRef.current?.getValue()).toBe('hello world')
  })

  it('commits a composed CJK character once and keeps the caret after the composition', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createReactRoot(container)
    const inputRef = createRef<ComposerLexicalInputHandle>()
    const changes: string[] = []
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(
        <ComposerLexicalInput
          ref={inputRef}
          initialValue="hello"
          onChange={(value) => changes.push(value)}
        />,
      )
    })

    const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')
    const paragraph = editor?.querySelector<HTMLElement>('.composer-input-paragraph')
    const textNode = paragraph?.firstElementChild?.firstChild
    expect(editor).not.toBeNull()
    expect(textNode).toBeInstanceOf(Text)

    await act(async () => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(5, 5)
      setDomCaret(textNode as Text)
      editor?.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))

      textNode!.textContent = 'hello n'
      setDomCaret(textNode as Text)
      editor?.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertCompositionText',
          data: 'n',
        }),
      )

      textNode!.textContent = 'hello 你'
      setDomCaret(textNode as Text)
      editor?.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          inputType: 'insertCompositionText',
          data: '你',
        }),
      )
      editor?.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '你' }))
      await Promise.resolve()
    })

    expect(inputRef.current?.getValue()).toBe('hello 你')
    expect(inputRef.current?.getSelection()).toEqual({ start: 7, end: 7 })
    expect(changes.at(-1)).toBe('hello 你')
  })

  it('deletes a token atomically with Backspace and supports keyboard undo and redo', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createReactRoot(container)
    const inputRef = createRef<ComposerLexicalInputHandle>()
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(
        <ComposerLexicalInput
          ref={inputRef}
          initialValue="before /review after"
          commandNames={['review']}
          onChange={vi.fn()}
        />,
      )
    })

    const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(editor).not.toBeNull()
    const tokenStart = 'before '.length
    const tokenEnd = tokenStart + '/review'.length

    await act(async () => {
      inputRef.current?.focus()
    })
    await act(async () => {
      inputRef.current?.setSelectionRange(tokenEnd, tokenEnd)
    })
    expect(document.activeElement).toBe(editor)
    expect(inputRef.current?.getSelection()).toEqual({ start: tokenEnd, end: tokenEnd })
    await act(async () => {
      editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))
    })
    expect(inputRef.current?.getValue()).toBe('before  after')

    await act(async () => {
      inputRef.current?.setSelectionRange('before  after'.length, 'before  after'.length)
      inputRef.current?.focus()
      inputRef.current?.replaceSelection('done')
    })
    expect(inputRef.current?.getValue()).toBe('before  afterdone')

    await act(async () => {
      inputRef.current?.focus()
      editor?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      )
    })
    expect(inputRef.current?.getValue()).toBe('before  after')

    await act(async () => {
      inputRef.current?.focus()
      editor?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
        }),
      )
    })
    expect(inputRef.current?.getValue()).toBe('before  afterdone')
  })
})
