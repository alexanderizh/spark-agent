// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteControlWindowState } from '@spark/protocol'
import { useRemoteControlWindowState } from './useRemoteControlWindowState'

vi.mock('@spark/shared', () => ({
  createLogger: () => ({ warn: vi.fn() }),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CHANNEL = 'stream:remote-control:window-state'
const handlers = new Map<string, (state: RemoteControlWindowState) => void>()

function StateLabel() {
  const isOpen = useRemoteControlWindowState()
  return <span>{isOpen ? '已打开' : '已关闭'}</span>
}

describe('useRemoteControlWindowState', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  let resolveSnapshot: ((state: RemoteControlWindowState) => void) | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    handlers.clear()
    resolveSnapshot = null
    const snapshot = new Promise<RemoteControlWindowState>((resolve) => {
      resolveSnapshot = resolve
    })
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: {
        on: vi.fn((channel: string, handler: (state: RemoteControlWindowState) => void) => {
          handlers.set(channel, handler)
          return () => handlers.delete(channel)
        }),
        invoke: vi.fn(() => snapshot),
      },
    })
  })

  afterEach(() => {
    if (root != null) {
      act(() => root?.unmount())
      root = null
    }
    container.remove()
  })

  it('restores from events and ignores a stale initial snapshot', async () => {
    await act(async () => {
      root = createRoot(container)
      root.render(<StateLabel />)
    })
    expect(container.textContent).toBe('已关闭')

    await act(async () => {
      handlers.get(CHANNEL)?.({ open: true, revision: 1 })
    })
    expect(container.textContent).toBe('已打开')

    await act(async () => {
      resolveSnapshot?.({ open: false, revision: 0 })
      await Promise.resolve()
    })
    expect(container.textContent).toBe('已打开')

    await act(async () => {
      handlers.get(CHANNEL)?.({ open: false, revision: 2 })
    })
    expect(container.textContent).toBe('已关闭')
  })
})
