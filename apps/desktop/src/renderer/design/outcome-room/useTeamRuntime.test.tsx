// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeliberationSnapshot, SessionId, TaskGraphSnapshot } from '@spark/protocol'
import { useTeamRuntime } from './useTeamRuntime'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionA = '11111111-1111-4111-8111-111111111111' as SessionId
const sessionB = '22222222-2222-4222-8222-222222222222' as SessionId

const graph = (sessionId: SessionId): TaskGraphSnapshot => ({
  sessionId,
  discussionId: 'discussion-1',
  nodes: [],
  edges: [],
  syncedAt: `${sessionId}-synced`,
})

const deliberation = (sessionId: SessionId): DeliberationSnapshot => ({
  sessionId,
  discussionId: 'discussion-1',
  records: [],
  conflicts: [],
  syncedAt: `${sessionId}-synced`,
})

function Harness({
  sessionId,
  onState,
}: {
  sessionId: SessionId
  onState: (state: ReturnType<typeof useTeamRuntime>) => void
}) {
  onState(useTeamRuntime(sessionId))
  return null
}

describe('useTeamRuntime', () => {
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
    vi.useRealTimers()
  })

  it('loads task graph and deliberation snapshots in parallel', async () => {
    invoke.mockImplementation((channel: string) =>
      Promise.resolve(channel === 'task-graph:get' ? graph(sessionA) : deliberation(sessionA)),
    )
    const state: { current?: ReturnType<typeof useTeamRuntime> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness sessionId={sessionA} onState={(current) => { state.current = current }} />)
    })

    expect(invoke).toHaveBeenCalledWith('task-graph:get', { sessionId: sessionA })
    expect(invoke).toHaveBeenCalledWith('deliberation:get', { sessionId: sessionA })
    expect(state.current?.taskGraph).toEqual(graph(sessionA))
    expect(state.current?.deliberation).toEqual(deliberation(sessionA))
    expect(state.current?.loading).toBe(false)
  })

  it('drops stale responses after switching sessions', async () => {
    const resolvers = new Map<string, (value: unknown) => void>()
    invoke.mockImplementation((channel: string, request: { sessionId: SessionId }) =>
      new Promise((resolve) => { resolvers.set(`${channel}:${request.sessionId}`, resolve) }),
    )
    const state: { current?: ReturnType<typeof useTeamRuntime> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness sessionId={sessionA} onState={(current) => { state.current = current }} />)
    })
    await act(async () => {
      root?.render(<Harness sessionId={sessionB} onState={(current) => { state.current = current }} />)
    })

    await act(async () => {
      resolvers.get(`task-graph:get:${sessionA}`)?.(graph(sessionA))
      resolvers.get(`deliberation:get:${sessionA}`)?.(deliberation(sessionA))
      resolvers.get(`task-graph:get:${sessionB}`)?.(graph(sessionB))
      resolvers.get(`deliberation:get:${sessionB}`)?.(deliberation(sessionB))
    })
    expect(state.current?.taskGraph?.sessionId).toBe(sessionB)
    expect(state.current?.deliberation?.sessionId).toBe(sessionB)
  })

  it('reuses a stable operation id and keeps the mutation snapshot', async () => {
    const next = { ...graph(sessionA), syncedAt: 'after-mutation' }
    invoke.mockImplementation((channel: string) => {
      if (channel === 'task-graph:get') return Promise.resolve(graph(sessionA))
      if (channel === 'deliberation:get') return Promise.resolve(deliberation(sessionA))
      return Promise.resolve({ snapshot: next })
    })
    const state: { current?: ReturnType<typeof useTeamRuntime> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness sessionId={sessionA} onState={(current) => { state.current = current }} />)
    })

    await act(async () => {
      await state.current?.mutateTaskGraph({
        expectedDiscussionId: 'discussion-1',
        kind: 'node',
        action: 'retry',
        id: 'node-1',
        expectedVersion: 4,
      })
    })
    await act(async () => {
      await state.current?.mutateTaskGraph({
        expectedDiscussionId: 'discussion-1',
        kind: 'node',
        action: 'retry',
        id: 'node-1',
        expectedVersion: 4,
      })
    })
    const requests = invoke.mock.calls
      .filter(([channel]) => channel === 'task-graph:mutate')
      .map(([, request]) => request)
    expect(requests).toHaveLength(2)
    expect(requests[0].opId).toBe(requests[1].opId)
    expect(requests[0].sessionId).toBe(sessionA)
    expect(state.current?.taskGraph).toEqual(next)
  })

  it('keeps refresh single-flight while a read is pending', async () => {
    vi.useFakeTimers()
    let resolveGraph: ((value: TaskGraphSnapshot) => void) | undefined
    let resolveDeliberation: ((value: DeliberationSnapshot) => void) | undefined
    invoke.mockImplementation((channel: string) => channel === 'task-graph:get'
      ? new Promise((resolve) => { resolveGraph = resolve })
      : new Promise((resolve) => { resolveDeliberation = resolve }))
    const state: { current?: ReturnType<typeof useTeamRuntime> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness sessionId={sessionA} onState={(current) => { state.current = current }} />)
    })
    let refresh: Promise<void> | undefined
    await act(async () => {
      refresh = state.current?.refresh()
      vi.advanceTimersByTime(8_000)
    })
    expect(invoke).toHaveBeenCalledTimes(2)
    await act(async () => {
      resolveGraph?.(graph(sessionA))
      resolveDeliberation?.(deliberation(sessionA))
      await refresh
    })
  })
})
