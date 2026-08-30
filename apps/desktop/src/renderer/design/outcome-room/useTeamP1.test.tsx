// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId, TeamP1Snapshot } from '@spark/protocol'
import { useTeamP1 } from './useTeamP1'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionA = '11111111-1111-4111-8111-111111111111' as SessionId
const sessionB = '22222222-2222-4222-8222-222222222222' as SessionId
const empty = (sessionId: SessionId): TeamP1Snapshot => ({
  sessionId, discussionId: 'discussion-1', handoffs: [], gates: [], syncedAt: '2026-08-13T00:00:00.000Z',
})

function Harness({ sessionId, onState }: { sessionId: SessionId; onState: (state: ReturnType<typeof useTeamP1>) => void }) {
  onState(useTeamP1(sessionId))
  return null
}

describe('useTeamP1', () => {
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

  it('shows loading and error while keeping the latest good snapshot', async () => {
    let rejectRead: ((reason: Error) => void) | undefined
    invoke.mockImplementation(() => new Promise((_, reject) => { rejectRead = reject }))
    const state: { current?: ReturnType<typeof useTeamP1> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness sessionId={sessionA} onState={(current) => { state.current = current }} />)
    })
    expect(state.current?.loading).toBe(true)
    await act(async () => rejectRead?.(new Error('同步失败')))
    expect(state.current?.loading).toBe(false)
    expect(state.current?.error).toBe('同步失败')
  })

  it('drops an old session response and sends one stable operation id', async () => {
    const resolvers = new Map<SessionId, (value: TeamP1Snapshot) => void>()
    invoke.mockImplementation((channel: string, request: { sessionId: SessionId }) => {
      if (channel === 'team-p1:get') return new Promise((resolve) => { resolvers.set(request.sessionId, resolve) })
      return Promise.resolve({ snapshot: empty(request.sessionId) })
    })
    const state: { current?: ReturnType<typeof useTeamP1> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness sessionId={sessionA} onState={(current) => { state.current = current }} />)
    })
    await act(async () => {
      root?.render(<Harness sessionId={sessionB} onState={(current) => { state.current = current }} />)
    })
    await act(async () => resolvers.get(sessionA)?.(empty(sessionA)))
    expect(state.current?.snapshot).toBeNull()

    await act(async () => resolvers.get(sessionB)?.(empty(sessionB)))
    await act(async () => state.current?.mutate({
      expectedDiscussionId: 'discussion-1', kind: 'gate', action: 'approve', id: 'gate-1', expectedVersion: 1,
    }))
    const mutation = invoke.mock.calls.find(([channel]) => channel === 'team-p1:mutate')?.[1]
    expect(mutation.opId).toMatch(/^team-p1:/)
    expect(mutation.sessionId).toBe(sessionB)
    expect(state.current?.snapshot?.sessionId).toBe(sessionB)
    expect(state.current?.error).toBeNull()
  })
})
