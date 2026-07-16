// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { scrollTextareaCaretIntoView } from '../design/views/chat/composer-caret-scroll'

function mockLayout(textarea: HTMLTextAreaElement, clientHeight: number, scrollHeight: number) {
  Object.defineProperty(textarea, 'clientHeight', { configurable: true, value: clientHeight })
  Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: scrollHeight })
  textarea.getBoundingClientRect = () =>
    ({ top: 100, left: 0, width: 400, height: clientHeight }) as DOMRect
}

describe('scrollTextareaCaretIntoView', () => {
  it('scrolls down when the caret moves below the visible area', () => {
    const container = document.createElement('div')
    const highlights = document.createElement('div')
    highlights.className = 'composer-input-highlights'
    const textarea = document.createElement('textarea')
    container.append(highlights, textarea)
    document.body.appendChild(container)
    mockLayout(textarea, 100, 300)
    textarea.scrollTop = 100

    scrollTextareaCaretIntoView(textarea, () => ({ left: 0, top: 220 }))

    expect(textarea.scrollTop).toBe(120)
    expect(highlights.scrollTop).toBe(120)
  })

  it('does not jump when the caret is already visible', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    mockLayout(textarea, 100, 300)
    textarea.scrollTop = 80

    scrollTextareaCaretIntoView(textarea, () => ({ left: 0, top: 170 }))

    expect(textarea.scrollTop).toBe(80)
  })
})
