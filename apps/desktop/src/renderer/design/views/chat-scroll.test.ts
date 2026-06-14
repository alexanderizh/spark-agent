import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shouldShowScrollToBottom } from './chat-scroll'

describe('chat scroll controls', () => {
  it('shows the scroll-to-bottom button once the chat is more than 50px from bottom', () => {
    expect(shouldShowScrollToBottom(50)).toBe(false)
    expect(shouldShowScrollToBottom(51)).toBe(true)
  })

  it('keeps the outer stream as the only scroll container', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./ChatView.less', import.meta.url)),
      'utf8',
    )
    const streamBlock = stylesheet.match(/\.chat-stream\s*\{[^}]*\}/)?.[0] ?? ''
    const innerBlock = stylesheet.match(/\.chat-stream-inner\s*\{[^}]*\}/)?.[0] ?? ''

    expect(streamBlock).toContain('overflow-y: auto')
    expect(innerBlock).not.toContain('overflow-y: auto')
  })

  it('keeps the scroll-to-bottom button free of hover effects and shadows', () => {
    const componentStyles = readFileSync(
      fileURLToPath(new URL('./ChatView.less', import.meta.url)),
      'utf8',
    )
    const globalStyles = readFileSync(
      fileURLToPath(new URL('../styles/views.css', import.meta.url)),
      'utf8',
    )
    const buttonBlocks = [
      ...componentStyles.matchAll(/\.scroll-to-bottom-btn\s*\{[^}]*\}/g),
      ...globalStyles.matchAll(/\.scroll-to-bottom-btn\s*\{[^}]*\}/g),
    ].map((match) => match[0])

    expect(`${componentStyles}\n${globalStyles}`).not.toContain('.scroll-to-bottom-btn:hover')
    for (const block of buttonBlocks) {
      expect(block).not.toContain('box-shadow')
      expect(block).not.toContain('animation')
      expect(block).not.toContain('transition')
    }
  })
})
