// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, TeamP1Snapshot } from '@spark/protocol'
import { TeamP1Panel } from './TeamP1Panel'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId
const snapshot: TeamP1Snapshot = {
  sessionId, discussionId: 'discussion-1', handoffs: [], gates: [], syncedAt: '2026-08-13T00:00:00.000Z',
}

describe('TeamP1Panel', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  const invoke = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke.mockReset()
    Object.defineProperty(window, 'spark', { configurable: true, value: { invoke } })
  })
  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
  })

  it('renders loading, error and an explicit empty state', async () => {
    let rejectRead: ((reason: Error) => void) | undefined
    invoke.mockImplementation(() => new Promise((_, reject) => { rejectRead = reject }))
    await act(async () => {
      root = createRoot(container)
      root.render(<TeamP1Panel sessionId={sessionId} />)
    })
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    await act(async () => rejectRead?.(new Error('暂时无法同步')))
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('暂时无法同步')

    invoke.mockResolvedValue(snapshot)
    await act(async () => { await container.querySelector<HTMLButtonElement>('[aria-label="重新加载交接与 Steering Gate"]')?.click() })
    expect(container.textContent).toContain('暂无交接或 Steering Gate')
  })
})
