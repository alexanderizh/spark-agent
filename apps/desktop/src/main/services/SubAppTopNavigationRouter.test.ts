import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Event, WebContents, WebContentsWillNavigateEventParams } from 'electron'
import { installSubAppTopNavigationRouter } from './SubAppTopNavigationRouter.js'

describe('installSubAppTopNavigationRouter', () => {
  let cleanup: (() => void) | null = null

  afterEach(() => {
    cleanup?.()
    cleanup = null
  })

  function createHarness(currentUrl = 'http://localhost:5173/'): {
    fire: (url: string, isMainFrame?: boolean) => { preventDefault: ReturnType<typeof vi.fn> }
    on: ReturnType<typeof vi.fn>
    removeListener: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
  } {
    let listener:
      | ((event: Event<WebContentsWillNavigateEventParams>, url: string) => void)
      | undefined
    const on = vi.fn((_event: string, next: typeof listener) => {
      listener = next
    })
    const removeListener = vi.fn()
    const send = vi.fn()
    const contents = {
      getURL: () => currentUrl,
      on,
      removeListener,
      send,
    } as unknown as WebContents
    cleanup = installSubAppTopNavigationRouter(contents)

    return {
      fire(url, isMainFrame = true) {
        const preventDefault = vi.fn()
        listener?.(
          {
            preventDefault,
            defaultPrevented: false,
            isMainFrame,
            isSameDocument: false,
            url,
            frame: null,
          },
          url,
        )
        return { preventDefault }
      },
      on,
      removeListener,
      send,
    }
  }

  it('routes HTTP(S) top-level navigation to the isolated browser panel', () => {
    const harness = createHarness()
    const { preventDefault } = harness.fire('https://sparkrouter.to/#/futures')

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(harness.send).toHaveBeenCalledWith('stream:browser-panel:restore', {
      url: 'https://sparkrouter.to/#/futures',
    })
  })

  it('allows navigation within the current renderer origin', () => {
    const harness = createHarness()
    const { preventDefault } = harness.fire('http://localhost:5173/settings')

    expect(preventDefault).not.toHaveBeenCalled()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('does not reroute external subframe iframe navigations', () => {
    const harness = createHarness()
    const { preventDefault } = harness.fire('https://example.com/embed', false)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('only allows the current file document in packaged mode', () => {
    const harness = createHarness('file:///Applications/SparkWork/index.html')
    const { preventDefault } = harness.fire('file:///Users/guest/private.txt')

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('blocks non-HTTP(S) and credential-bearing destinations', () => {
    const harness = createHarness()
    const blocked = harness.fire('javascript:alert(1)')
    const credentialed = harness.fire('https://user:password@example.com/')

    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    expect(credentialed.preventDefault).toHaveBeenCalledOnce()
    expect(harness.send).not.toHaveBeenCalled()
  })

  it('removes its navigation listener when disposed', () => {
    const harness = createHarness()
    cleanup?.()
    cleanup = null

    expect(harness.removeListener).toHaveBeenCalledOnce()
  })
})
