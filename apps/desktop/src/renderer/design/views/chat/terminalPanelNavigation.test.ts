// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPEN_TERMINAL_PANEL_EVENT,
  OPEN_TERMINAL_PANEL_PENDING_KEY,
  clearPendingOpenTerminalPanel,
  consumePendingOpenTerminalPanel,
  requestOpenTerminalPanel,
} from './terminalPanelNavigation'

describe('terminal panel navigation signal', () => {
  afterEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('writes a pending flag and dispatches the event on request', () => {
    const events: Event[] = []
    const listener = (event: Event): void => {
      events.push(event)
    }
    window.addEventListener(OPEN_TERMINAL_PANEL_EVENT, listener)
    try {
      requestOpenTerminalPanel()

      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe(OPEN_TERMINAL_PANEL_EVENT)
      expect(window.localStorage.getItem(OPEN_TERMINAL_PANEL_PENDING_KEY)).not.toBeNull()
    } finally {
      window.removeEventListener(OPEN_TERMINAL_PANEL_EVENT, listener)
    }
  })

  it('consumes the pending flag once and rejects stale residue', () => {
    expect(consumePendingOpenTerminalPanel()).toBe(false)

    // 正常请求：首次消费成功，二次落空
    window.localStorage.setItem(OPEN_TERMINAL_PANEL_PENDING_KEY, String(Date.now()))
    expect(consumePendingOpenTerminalPanel()).toBe(true)
    expect(consumePendingOpenTerminalPanel()).toBe(false)

    // 超期残留（如应用在挂载前被杀）：清除但不再消费
    window.localStorage.setItem(OPEN_TERMINAL_PANEL_PENDING_KEY, String(Date.now() - 60_000))
    expect(consumePendingOpenTerminalPanel()).toBe(false)
    expect(window.localStorage.getItem(OPEN_TERMINAL_PANEL_PENDING_KEY)).toBeNull()
  })

  it('clears the pending flag after immediate event handling', () => {
    window.localStorage.setItem(OPEN_TERMINAL_PANEL_PENDING_KEY, String(Date.now()))
    clearPendingOpenTerminalPanel()
    expect(window.localStorage.getItem(OPEN_TERMINAL_PANEL_PENDING_KEY)).toBeNull()
  })
})
