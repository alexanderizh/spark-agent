// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BROWSER_PANEL_NAVIGATE_EVENT, BROWSER_PANEL_OPEN_EVENT } from '../../components/browser/browserChromeShared'
import {
  OPEN_BROWSER_PANEL_PENDING_KEY,
  clearPendingOpenBrowserPanel,
  consumePendingOpenBrowserPanel,
  handOffBrowserNavigate,
  requestOpenBrowserPanel,
} from './browserPanelNavigation'

describe('browser panel navigation signal', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('writes a pending flag (with url) and dispatches the open event on request', () => {
    const events: Event[] = []
    const listener = (event: Event): void => {
      events.push(event)
    }
    window.addEventListener(BROWSER_PANEL_OPEN_EVENT, listener)
    try {
      requestOpenBrowserPanel('https://example.com/a')

      expect(events).toHaveLength(1)
      expect((events[0] as CustomEvent<{ url?: string }>).detail?.url).toBe(
        'https://example.com/a',
      )
      const raw = window.localStorage.getItem(OPEN_BROWSER_PANEL_PENDING_KEY)
      expect(raw).not.toBeNull()
      expect(JSON.parse(String(raw))).toMatchObject({ url: 'https://example.com/a' })
    } finally {
      window.removeEventListener(BROWSER_PANEL_OPEN_EVENT, listener)
    }
  })

  it('consumes the pending flag once and rejects stale residue', () => {
    expect(consumePendingOpenBrowserPanel()).toBeNull()

    // 正常请求：首次消费成功（带 URL），二次落空
    window.localStorage.setItem(
      OPEN_BROWSER_PANEL_PENDING_KEY,
      JSON.stringify({ url: 'https://example.com/', ts: Date.now() }),
    )
    expect(consumePendingOpenBrowserPanel()).toEqual({ url: 'https://example.com/' })
    expect(consumePendingOpenBrowserPanel()).toBeNull()

    // 超期残留（如应用在挂载前被杀）：清除但不再消费
    window.localStorage.setItem(
      OPEN_BROWSER_PANEL_PENDING_KEY,
      JSON.stringify({ ts: Date.now() - 60_000 }),
    )
    expect(consumePendingOpenBrowserPanel()).toBeNull()
    expect(window.localStorage.getItem(OPEN_BROWSER_PANEL_PENDING_KEY)).toBeNull()
  })

  it('consumes requests without url as an empty object', () => {
    window.localStorage.setItem(
      OPEN_BROWSER_PANEL_PENDING_KEY,
      JSON.stringify({ ts: Date.now() }),
    )
    expect(consumePendingOpenBrowserPanel()).toEqual({})
  })

  it('handOffBrowserNavigate dispatches navigate event with the url', () => {
    const events: Event[] = []
    const listener = (event: Event): void => {
      events.push(event)
    }
    window.addEventListener(BROWSER_PANEL_NAVIGATE_EVENT, listener)
    try {
      handOffBrowserNavigate('https://example.com/next')
      expect(events).toHaveLength(1)
      expect((events[0] as CustomEvent<{ url?: string }>).detail?.url).toBe(
        'https://example.com/next',
      )
    } finally {
      window.removeEventListener(BROWSER_PANEL_NAVIGATE_EVENT, listener)
    }
  })

  it('clears the pending flag after immediate event handling', () => {
    window.localStorage.setItem(
      OPEN_BROWSER_PANEL_PENDING_KEY,
      JSON.stringify({ ts: Date.now() }),
    )
    clearPendingOpenBrowserPanel()
    expect(window.localStorage.getItem(OPEN_BROWSER_PANEL_PENDING_KEY)).toBeNull()
  })
})
