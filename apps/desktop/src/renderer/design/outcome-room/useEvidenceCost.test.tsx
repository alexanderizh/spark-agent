// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@spark/protocol'
import { useEvidenceCost } from './useEvidenceCost'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionA = '11111111-1111-4111-8111-111111111111' as SessionId
const sessionB = '22222222-2222-4222-8222-222222222222' as SessionId
const discussionA = 'discussion-1'
const discussionB = 'discussion-2'
const snapshot = (sessionId: SessionId) => ({
  sessionId, roomId: `team-room:${sessionId}`, discussionId: 'discussion-1', evidence: [], costs: [], aggregates: [],
  budgetTokens: 100, budgetAmount: null, budgetCurrency: null, syncedAt: '2026-08-14T00:00:00.000Z',
})

function Harness({ sessionId, discussionId = discussionA, onState }: { sessionId: SessionId; discussionId?: string; onState: (state: ReturnType<typeof useEvidenceCost>) => void }) {
  onState(useEvidenceCost(sessionId, discussionId))
  return null
}

describe('useEvidenceCost', () => {
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

  it('coalesces reads and sends a stable CAS operation id', async () => {
    let resolveRead: ((value: unknown) => void) | undefined
    invoke.mockImplementation((channel: string) => channel === 'evidence-cost:get'
      ? new Promise((resolve) => { resolveRead = resolve })
      : Promise.resolve(snapshot(sessionA)))
    const state: { current?: ReturnType<typeof useEvidenceCost> } = {}
    await act(async () => { root = createRoot(container); root.render(<Harness sessionId={sessionA} onState={(current) => { state.current = current }} />) })
    await act(async () => { void state.current?.refresh(); void state.current?.refresh() })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'evidence-cost:get')).toHaveLength(1)
    await act(async () => resolveRead?.(snapshot(sessionA)))
    await act(async () => state.current?.mutate({ kind: 'budget', action: 'set', expectedVersion: 0, tokens: 90 }))
    const request = invoke.mock.calls.find(([channel]) => channel === 'evidence-cost:mutate')?.[1] as Record<string, unknown>
    expect(request).toMatchObject({ sessionId: sessionA, expectedDiscussionId: discussionA, tokens: 90 })
    expect(request.opId).toMatch(/^evidence-cost:/)
  })

  it('drops an old session response and cleans loading after failure', async () => {
    const resolvers = new Map<SessionId, (value: unknown) => void>()
    invoke.mockImplementation((channel: string, request: { sessionId: SessionId }) => channel === 'evidence-cost:get'
      ? new Promise((resolve) => { resolvers.set(request.sessionId, resolve) })
      : Promise.reject(new Error('冲突：Expected budget version 1')))
    const state: { current?: ReturnType<typeof useEvidenceCost> } = {}
    await act(async () => { root = createRoot(container); root.render(<Harness sessionId={sessionA} onState={(current) => { state.current = current }} />) })
    await act(async () => { root?.render(<Harness sessionId={sessionB} onState={(current) => { state.current = current }} />) })
    await act(async () => resolvers.get(sessionA)?.(snapshot(sessionA)))
    expect(state.current?.snapshot?.sessionId).not.toBe(sessionA)
    await act(async () => resolvers.get(sessionB)?.(snapshot(sessionB)))
    expect(state.current?.loading).toBe(false)
    await act(async () => {
      await expect(state.current?.mutate({ kind: 'budget', action: 'set', expectedVersion: 0, tokens: 80 }))
        .rejects.toThrow('Expected budget version')
    })
    expect(state.current?.loading).toBe(false)
    expect(state.current?.error).toContain('Expected budget version')
  })

  it('reuses the same operation id when a CAS mutation is retried', async () => {
    let attempts = 0
    invoke.mockImplementation((channel: string) => {
      if (channel === 'evidence-cost:get') return Promise.resolve(snapshot(sessionA))
      attempts += 1
      return attempts === 1 ? Promise.reject(new Error('Expected budget version 1, current version is 2')) : Promise.resolve(snapshot(sessionA))
    })
    const state: { current?: ReturnType<typeof useEvidenceCost> } = {}
    await act(async () => { root = createRoot(container); root.render(<Harness sessionId={sessionA} onState={(current) => { state.current = current }} />) })
    await act(async () => {
      await expect(state.current?.mutate({ kind: 'budget', action: 'set', expectedVersion: 0, tokens: 80 }))
        .rejects.toThrow('Expected budget version')
    })
    await act(async () => { await state.current?.mutate({ kind: 'budget', action: 'set', expectedVersion: 0, tokens: 80 }) })
    const mutations = invoke.mock.calls.filter(([channel]) => channel === 'evidence-cost:mutate')
    expect(mutations).toHaveLength(2)
    expect((mutations[0]?.[1] as Record<string, unknown>).opId).toBe((mutations[1]?.[1] as Record<string, unknown>).opId)
  })

  it('drops an old response when the discussion changes within one session', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    invoke.mockImplementation((channel: string) => channel === 'evidence-cost:get'
      ? new Promise((resolve) => { resolvers.push(resolve) })
      : Promise.resolve(snapshot(sessionA)))
    const state: { current?: ReturnType<typeof useEvidenceCost> } = {}
    await act(async () => { root = createRoot(container); root.render(<Harness sessionId={sessionA} discussionId={discussionA} onState={(current) => { state.current = current }} />) })
    await act(async () => { root?.render(<Harness sessionId={sessionA} discussionId={discussionB} onState={(current) => { state.current = current }} />) })
    await act(async () => resolvers[0]?.({ ...snapshot(sessionA), discussionId: discussionA, budgetTokens: 10 }))
    expect(state.current?.snapshot).toBeNull()
    await act(async () => resolvers[1]?.({ ...snapshot(sessionA), discussionId: discussionB, budgetTokens: 20 }))
    expect(state.current?.snapshot?.discussionId).toBe(discussionB)
    expect(state.current?.snapshot?.budgetTokens).toBe(20)
  })
})
