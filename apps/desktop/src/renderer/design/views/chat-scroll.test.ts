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
    expect(streamBlock).toContain('scrollbar-gutter: stable both-edges')
    expect(innerBlock).not.toContain('overflow-y: auto')
  })

  it('restores the native scrollbar only for the main chat content stream', () => {
    const baseStyles = readFileSync(
      fileURLToPath(new URL('../styles/styles.css', import.meta.url)),
      'utf8',
    )
    const overrideStyles = readFileSync(
      fileURLToPath(new URL('../styles/global-overrides.css', import.meta.url)),
      'utf8',
    )

    expect(baseStyles).toContain('*::-webkit-scrollbar')
    expect(baseStyles).toContain('scrollbar-width: none !important')
    expect(overrideStyles).toContain(
      '.chat-main-active > .chat-stream-viewport > .chat-stream',
    )
    expect(overrideStyles).toContain('scrollbar-width: auto !important')
    expect(overrideStyles).toContain('::-webkit-scrollbar-thumb')
    expect(overrideStyles).not.toContain('.sidebar')
  })

  it('keeps the active chat stream and composer containers width-aligned', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./ChatView.less', import.meta.url)),
      'utf8',
    )
    const sharedContainerBlock =
      stylesheet.match(
        /\.chat-main-active \.chat-stream-inner,\s*\.chat-main-active \.composer-inner\s*\{[^}]*\}/,
      )?.[0] ?? ''
    const gitGutterBlocks = [
      ...stylesheet.matchAll(
        /\.chat-main-active\.git-env-panel-open \.chat-stream-inner,\s*\.chat-main-active\.git-env-panel-open \.composer-inner\s*\{[^}]*\}/g,
      ),
    ].map((match) => match[0])

    expect(sharedContainerBlock).toContain('width: min(100%, 900px)')
    expect(sharedContainerBlock).toContain('padding-inline: 16px')
    expect(gitGutterBlocks.some((block) => block.includes('--git-gutter-base: 16px'))).toBe(true)
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
