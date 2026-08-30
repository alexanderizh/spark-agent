// @vitest-environment jsdom

import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ComposerLexicalInput, type ComposerLexicalInputHandle } from './ComposerLexicalInput'
import { useComposerInputAutoSize } from './useComposerInputAutoSize'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mountedRoots: Array<{ root: Root; container: HTMLElement }> = []

function AutoSizeHarness({ value, draftBucketKey }: { value: string; draftBucketKey: string }) {
  const inputRef = useRef<ComposerLexicalInputHandle | null>(null)
  useComposerInputAutoSize({ inputRef, draftBucketKey, manualExpanded: false, value })
  return <ComposerLexicalInput ref={inputRef} value={value} onChange={vi.fn()} />
}

describe('useComposerInputAutoSize', () => {
  let rafCallbacks: FrameRequestCallback[]

  beforeEach(() => {
    rafCallbacks = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback)
      return rafCallbacks.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() {
        return this.matches('[contenteditable="true"]') && (this.textContent?.length ?? 0) > 0
          ? 600
          : 0
      },
    })
  })

  afterEach(async () => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop()
      if (mounted == null) continue
      await act(async () => mounted.root.unmount())
      mounted.container.remove()
    }
    vi.unstubAllGlobals()
  })

  it('remeasures after switching from a long draft to an empty session draft', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    mountedRoots.push({ root, container })

    await act(async () => {
      root.render(<AutoSizeHarness value="long draft" draftBucketKey="session-1" />)
    })
    const editor = container.querySelector<HTMLElement>('[contenteditable="true"]')
    expect(editor?.style.height).toBe('280px')
    rafCallbacks = []

    await act(async () => {
      root.render(<AutoSizeHarness value="" draftBucketKey="session-2" />)
    })
    expect(editor?.style.height).toBe('280px')

    await act(async () => {
      await Promise.resolve()
      const callbacks = rafCallbacks.splice(0)
      callbacks.forEach((callback) => callback(0))
      const followUpCallbacks = rafCallbacks.splice(0)
      followUpCallbacks.forEach((callback) => callback(0))
    })

    expect(editor?.style.height).toBe('100px')
  })
})
