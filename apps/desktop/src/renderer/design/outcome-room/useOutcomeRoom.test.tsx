// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutcomeRoomSnapshot, SessionId } from '@spark/protocol'
import { useOutcomeRoom } from './useOutcomeRoom'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId
const initial: OutcomeRoomSnapshot = {
  sessionId,
  discussion: null,
  records: [],
  syncedAt: '2026-08-12T12:00:00.000Z',
}

function Harness({ onState }: { onState: (state: ReturnType<typeof useOutcomeRoom>) => void }) {
  const state = useOutcomeRoom(sessionId)
  onState(state)
  return null
}

function SwitchableHarness({ session, onState }: { session: SessionId; onState: (state: ReturnType<typeof useOutcomeRoom>) => void }) {
  const state = useOutcomeRoom(session)
  onState(state)
  return null
}

describe('useOutcomeRoom', () => {
  let container: HTMLDivElement
  let root: Root | null = null
  const invoke = vi.fn()

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    invoke.mockReset()
    Object.defineProperty(window, 'spark', {
      configurable: true,
      value: { invoke },
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container.remove()
    vi.useRealTimers()
  })

  it('loads the scoped snapshot and refreshes it when the app window regains focus', async () => {
    invoke.mockResolvedValue(initial)
    const state: { current?: ReturnType<typeof useOutcomeRoom> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={(current) => { state.current = current }} />)
    })
    expect(invoke).toHaveBeenCalledWith('outcome-room:get', { sessionId })
    expect(state.current?.snapshot).toEqual(initial)

    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('uses the mutation snapshot and exposes conflict errors without discarding the last good data', async () => {
    const next = { ...initial, syncedAt: '2026-08-12T12:01:00.000Z' }
    invoke
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce({ record: null, snapshot: next })
      .mockRejectedValueOnce(new Error('账本已被其他成员更新，请刷新后重试。'))
    const state: { current?: ReturnType<typeof useOutcomeRoom> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={(current) => { state.current = current }} />)
    })
    await act(async () => {
      await state.current?.mutate({ action: 'confirm', logicalKey: 'goal', expectedVersion: 1, expectedDiscussionId: 'd1', expectedRecordId: 'r1' })
    })
    expect(state.current?.snapshot).toEqual(next)

    await act(async () => {
      await state.current?.mutate({ action: 'confirm', logicalKey: 'goal', expectedVersion: 1, expectedDiscussionId: 'd1', expectedRecordId: 'r1' })
    })
    expect(state.current?.snapshot).toEqual(next)
    expect(state.current?.error).toContain('其他成员更新')
  })

  it('does not let a pending mutation from session A overwrite session B', async () => {
    const sessionB = '22222222-2222-4222-8222-222222222222' as SessionId
    const snapshotB = { ...initial, sessionId: sessionB, syncedAt: '2026-08-12T12:02:00.000Z' }
    let resolveMutationA: ((value: unknown) => void) | undefined
    invoke.mockImplementation((channel: string, request: { sessionId: SessionId }) => {
      if (channel === 'outcome-room:mutate') return new Promise((resolve) => { resolveMutationA = resolve })
      return Promise.resolve(request.sessionId === sessionB ? snapshotB : initial)
    })
    const state: { current?: ReturnType<typeof useOutcomeRoom> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<SwitchableHarness session={sessionId} onState={(current) => { state.current = current }} />)
    })
    let mutation: Promise<void> | undefined
    await act(async () => {
      mutation = state.current?.mutate({ action: 'confirm', logicalKey: 'goal', expectedVersion: 1, expectedDiscussionId: 'd1', expectedRecordId: 'r1' })
      root?.render(<SwitchableHarness session={sessionB} onState={(current) => { state.current = current }} />)
    })
    expect(state.current?.snapshot).toEqual(snapshotB)
    await act(async () => {
      resolveMutationA?.({ record: null, snapshot: initial })
      await mutation
    })
    expect(state.current?.snapshot).toEqual(snapshotB)
    expect(state.current?.mutatingKey).toBeNull()
  })

  it('polls while visible and stops polling on unmount', async () => {
    vi.useFakeTimers()
    invoke.mockResolvedValue(initial)
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={() => undefined} />)
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(2_000))
    expect(invoke).toHaveBeenCalledTimes(2)
    act(() => root?.unmount())
    root = null
    await act(async () => vi.advanceTimersByTimeAsync(4_000))
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('keeps one read in flight when a poll takes longer than the interval', async () => {
    vi.useFakeTimers()
    let resolveRead: ((value: OutcomeRoomSnapshot) => void) | undefined
    invoke.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve }))
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={() => undefined} />)
    })
    await act(async () => vi.advanceTimersByTimeAsync(6_000))
    expect(invoke).toHaveBeenCalledTimes(1)
    await act(async () => resolveRead?.(initial))
  })

  it('backs off after read failures and lets focus retry immediately', async () => {
    vi.useFakeTimers()
    invoke.mockRejectedValue(new Error('offline'))
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={() => undefined} />)
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(2_000))
    expect(invoke).toHaveBeenCalledTimes(1)
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does not poll while hidden and resumes immediately when visible', async () => {
    vi.useFakeTimers()
    let visibility: DocumentVisibilityState = 'hidden'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    invoke.mockResolvedValue(initial)
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={() => undefined} />)
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(invoke).toHaveBeenCalledTimes(1)
    visibility = 'visible'
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('does not let an older refresh overwrite a successful mutation snapshot', async () => {
    const fresh = { ...initial, syncedAt: '2026-08-12T12:09:00.000Z' }
    let resolveRefresh: ((value: OutcomeRoomSnapshot) => void) | undefined
    invoke.mockImplementation((channel: string) => {
      if (channel === 'outcome-room:get') return new Promise((resolve) => { resolveRefresh = resolve })
      return Promise.resolve({ record: null, snapshot: fresh })
    })
    const state: { current?: ReturnType<typeof useOutcomeRoom> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={(current) => { state.current = current }} />)
    })
    await act(async () => {
      await state.current?.mutate({ action: 'confirm', logicalKey: 'goal', expectedVersion: 1, expectedDiscussionId: 'd1', expectedRecordId: 'r1' })
    })
    expect(state.current?.snapshot).toEqual(fresh)
    expect(state.current?.loading).toBe(false)
    await act(async () => resolveRefresh?.(initial))
    expect(state.current?.snapshot).toEqual(fresh)
  })

  it('clears loading when a mutation fails after invalidating an in-flight refresh', async () => {
    let resolveRefresh: ((value: OutcomeRoomSnapshot) => void) | undefined
    invoke.mockImplementation((channel: string) => {
      if (channel === 'outcome-room:get') return new Promise((resolve) => { resolveRefresh = resolve })
      return Promise.reject(new Error('mutation failed'))
    })
    const state: { current?: ReturnType<typeof useOutcomeRoom> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={(current) => { state.current = current }} />)
    })
    await act(async () => {
      await state.current?.mutate({ action: 'confirm', logicalKey: 'goal', expectedVersion: 1, expectedDiscussionId: 'd1', expectedRecordId: 'r1' })
    })
    expect(state.current?.loading).toBe(false)
    expect(state.current?.error).toBe('mutation failed')
    await act(async () => resolveRefresh?.(initial))
    expect(state.current?.error).toBe('mutation failed')
  })

  it('ignores a second mutation for the same key while the first is pending', async () => {
    let resolveMutation: ((value: unknown) => void) | undefined
    invoke.mockImplementation((channel: string) => {
      if (channel === 'outcome-room:get') return Promise.resolve(initial)
      return new Promise((resolve) => { resolveMutation = resolve })
    })
    const state: { current?: ReturnType<typeof useOutcomeRoom> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness onState={(current) => { state.current = current }} />)
    })
    let first: Promise<void> | undefined
    await act(async () => {
      const payload = { action: 'confirm' as const, logicalKey: 'goal', expectedVersion: 1, expectedDiscussionId: 'd1', expectedRecordId: 'r1' }
      first = state.current?.mutate(payload)
      void state.current?.mutate(payload)
    })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'outcome-room:mutate')).toHaveLength(1)
    await act(async () => {
      resolveMutation?.({ record: null, snapshot: initial })
      await first
    })
  })
})
