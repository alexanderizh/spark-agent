// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { isKeyboardScrollIntentForContainer } from './chat-scroll'

describe('keyboard scroll intent gating', () => {
  const container = document.createElement('div')
  const innerChild = document.createElement('div')
  container.appendChild(innerChild)
  const textarea = document.createElement('textarea')

  it('treats upward keys with body focus (post-click default) as scroll intent', () => {
    expect(isKeyboardScrollIntentForContainer('ArrowUp', document.body, container)).toBe(true)
    expect(isKeyboardScrollIntentForContainer('PageUp', document.body, container)).toBe(true)
    expect(isKeyboardScrollIntentForContainer('Home', document.body, container)).toBe(true)
    expect(isKeyboardScrollIntentForContainer('ArrowUp', document.documentElement, container)).toBe(
      true,
    )
  })

  it('treats upward keys focused inside the stream container as scroll intent', () => {
    expect(isKeyboardScrollIntentForContainer('ArrowUp', innerChild, container)).toBe(true)
  })

  it('ignores keys that do not scroll upward', () => {
    expect(isKeyboardScrollIntentForContainer('ArrowDown', document.body, container)).toBe(false)
    expect(isKeyboardScrollIntentForContainer('PageDown', document.body, container)).toBe(false)
    expect(isKeyboardScrollIntentForContainer('End', document.body, container)).toBe(false)
    expect(isKeyboardScrollIntentForContainer('a', document.body, container)).toBe(false)
  })

  it('ignores keys typed inside editable targets (caret movement is not scrolling)', () => {
    expect(isKeyboardScrollIntentForContainer('ArrowUp', textarea, container)).toBe(false)
    const input = document.createElement('input')
    container.appendChild(input)
    expect(isKeyboardScrollIntentForContainer('ArrowUp', input, container)).toBe(false)
    const contentEditable = document.createElement('div')
    contentEditable.setAttribute('contenteditable', 'true')
    container.appendChild(contentEditable)
    expect(isKeyboardScrollIntentForContainer('ArrowUp', contentEditable, container)).toBe(false)
  })

  it('ignores keys targeting elements outside the stream container', () => {
    const sidebarButton = document.createElement('button')
    expect(isKeyboardScrollIntentForContainer('ArrowUp', sidebarButton, container)).toBe(false)
  })

  it('ignores non-HTMLElement targets and missing container', () => {
    expect(isKeyboardScrollIntentForContainer('ArrowUp', null, container)).toBe(false)
    expect(isKeyboardScrollIntentForContainer('ArrowUp', document.body, null)).toBe(false)
  })
})
