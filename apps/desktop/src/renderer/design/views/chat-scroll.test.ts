import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { shouldShowScrollToBottom } from './chat-scroll'
import { calculateOverlayScrollbarMetrics } from './chat/chat-overlay-scrollbar-metrics'

describe('chat scroll controls', () => {
  it('shows the scroll-to-bottom button once the chat is more than 50px from bottom', () => {
    expect(shouldShowScrollToBottom(50)).toBe(false)
    expect(shouldShowScrollToBottom(51)).toBe(true)
  })

  it('maps the native scroll position onto the overlay thumb', () => {
    const metrics = calculateOverlayScrollbarMetrics({
      viewportHeight: 500,
      contentHeight: 2_000,
      scrollTop: 750,
      trackHeight: 400,
    })

    expect(metrics.visible).toBe(true)
    expect(metrics.thumbHeight).toBe(100)
    expect(metrics.thumbTop).toBe(150)
    expect(metrics.maxScrollTop).toBe(1_500)
  })

  it('hides the overlay thumb when the conversation does not overflow', () => {
    const metrics = calculateOverlayScrollbarMetrics({
      viewportHeight: 500,
      contentHeight: 500,
      scrollTop: 0,
      trackHeight: 400,
    })

    expect(metrics.visible).toBe(false)
  })

  it('keeps the outer stream as the only scroll container without reserving a gutter', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./ChatView.less', import.meta.url)),
      'utf8',
    )
    const streamBlock = stylesheet.match(/\.chat-stream\s*\{[^}]*\}/)?.[0] ?? ''
    const innerBlock = stylesheet.match(/\.chat-stream-inner\s*\{[^}]*\}/)?.[0] ?? ''

    expect(streamBlock).toContain('overflow-y: auto')
    expect(streamBlock).toContain('scrollbar-gutter: auto')
    expect(innerBlock).not.toContain('overflow-y: auto')
  })

  it('keeps the native scrollbar hidden when the main chat uses the overlay thumb', () => {
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
    expect(overrideStyles).toContain('.chat-stream:not(.overlay-scrollbar-enabled)')
    expect(overrideStyles).toContain('scrollbar-width: auto !important')
    expect(overrideStyles).toContain('::-webkit-scrollbar-thumb')
    expect(overrideStyles).not.toContain('.sidebar')
  })

  it('renders the overlay scrollbar next to the width-neutral stream', () => {
    const component = readFileSync(
      fileURLToPath(new URL('./ChatView.tsx', import.meta.url)),
      'utf8',
    )
    const overlayComponent = readFileSync(
      fileURLToPath(new URL('./chat/ChatOverlayScrollbar.tsx', import.meta.url)),
      'utf8',
    )

    expect(component).toContain('chat-stream overlay-scrollbar-enabled')
    expect(component).toContain(
      '<ChatOverlayScrollbar scrollRef={streamRef} controlsId={streamId} />',
    )
    expect(overlayComponent).toContain('role="scrollbar"')
    expect(overlayComponent).toContain('ResizeObserver')
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
