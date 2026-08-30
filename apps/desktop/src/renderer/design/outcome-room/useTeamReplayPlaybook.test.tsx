// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@spark/protocol'
import { ReplayIpcSchemaRegistry } from '@spark/protocol'
import { z } from 'zod'
import { useTeamReplayPlaybook, type TeamReplayPlaybookListResponse } from './useTeamReplayPlaybook'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionA = '11111111-1111-4111-8111-111111111111' as SessionId
const sessionB = '22222222-2222-4222-8222-222222222222' as SessionId

const playbookListSchema = z.object({
  sessionId: z.string().uuid(),
  expectedDiscussionId: z.string().trim().min(1).max(160),
  id: z.string().trim().min(1).max(160),
  limit: z.number().int().min(1).max(100).optional(),
}).strict()

function parseRendererRequest(channel: string, request: Record<string, unknown>): void {
  if (channel === 'playbook:list') playbookListSchema.parse(request)
  else if (channel in ReplayIpcSchemaRegistry) {
    ReplayIpcSchemaRegistry[channel as keyof typeof ReplayIpcSchemaRegistry].parse(request)
  }
}

function timeline(sessionId: SessionId, discussionId: string, status: 'available' | 'partial' | 'empty' = 'partial') {
  return {
    timeline: {
      sessionId,
      discussionId,
      events: status === 'empty' ? [] : [{
        id: 'event-1', sessionId, roomId: `team-room:${sessionId}`, discussionId,
        sourceType: 'task' as const, sourceId: 'task-1', seq: 1,
        time: '2026-08-14T00:00:00.000Z', actor: 'agent-a', action: 'started',
        before: null, after: { status: 'running' }, evidenceRefs: [],
      }],
      cursor: null, nextCursor: status === 'partial' ? '1' : null, status,
      syncedAt: '2026-08-14T00:00:00.000Z',
    },
  }
}

function playbook(sessionId: SessionId, discussionId: string) {
  return {
    id: 'playbook-1', sessionId, roomId: `team-room:${sessionId}`, discussionId,
    version: 1, status: 'proposed' as const, name: 'Release flow', graph: {}, roles: {},
    handoffRules: {}, gateRules: {}, deliberationRules: {}, createdBy: 'agent-a',
    createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
  }
}

function list(sessionId: SessionId, discussionId: string): TeamReplayPlaybookListResponse {
  const current = playbook(sessionId, discussionId)
  return { playbook: current, versions: [current], applications: [] }
}

function Harness({ sessionId, discussionId, activePlaybookId = 'playbook-1', onState }: {
  sessionId: SessionId
  discussionId: string
  activePlaybookId?: string
  onState: (state: ReturnType<typeof useTeamReplayPlaybook>) => void
}) {
  onState(useTeamReplayPlaybook(sessionId, discussionId, activePlaybookId))
  return null
}

describe('useTeamReplayPlaybook', () => {
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

  it('loads the initial timeline and playbook once, exposing loading and empty states', async () => {
    invoke.mockImplementation((channel: string, request: { sessionId: SessionId; expectedDiscussionId: string }) =>
      channel === 'replay:timeline' ? Promise.resolve(timeline(request.sessionId, request.expectedDiscussionId, 'empty')) : Promise.resolve(list(request.sessionId, request.expectedDiscussionId)))
    const states: Array<ReturnType<typeof useTeamReplayPlaybook>> = []
    await act(async () => { root = createRoot(container); root.render(<Harness sessionId={sessionA} discussionId="discussion-a" onState={(state) => { states.push(state) }} />) })
    const state = states.at(-1)
    expect(state?.loading).toBe(false)
    expect(state?.timeline?.status).toBe('empty')
    expect(state?.playbook?.name).toBe('Release flow')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'replay:timeline')).toHaveLength(1)
    expect(invoke.mock.calls.filter(([channel]) => channel === 'playbook:list')).toHaveLength(1)
  })

  it('sends renderer requests accepted by the strict IPC schemas', async () => {
    invoke.mockImplementation((channel: string, request: Record<string, unknown>) => {
      parseRendererRequest(channel, request)
      if (channel === 'replay:timeline') return Promise.resolve(timeline(request.sessionId as SessionId, request.expectedDiscussionId as string))
      return Promise.resolve(list(request.sessionId as SessionId, request.expectedDiscussionId as string))
    })
    const states: Array<ReturnType<typeof useTeamReplayPlaybook>> = []
    await act(async () => {
      root = createRoot(container)
      root.render(<Harness sessionId={sessionA} discussionId="discussion-a" onState={(state) => { states.push(state) }} />)
    })
    expect(states.at(-1)?.error).toBeNull()
    expect(invoke.mock.calls.find(([channel]) => channel === 'replay:timeline')?.[1]).toEqual(expect.objectContaining({ opId: expect.any(String) }))
    expect(invoke.mock.calls.find(([channel]) => channel === 'playbook:list')?.[1]).toEqual(expect.objectContaining({ id: 'playbook-1' }))
  })

  it('reads diff and creates a branch with the active session/discussion scope', async () => {
    invoke.mockImplementation((channel: string, request: Record<string, unknown>) => {
      parseRendererRequest(channel, request)
      if (channel === 'replay:timeline') return Promise.resolve(timeline(request.sessionId as SessionId, request.expectedDiscussionId as string))
      if (channel === 'playbook:list') return Promise.resolve(list(request.sessionId as SessionId, request.expectedDiscussionId as string))
      if (channel === 'replay:diff') return Promise.resolve({ sessionId: request.sessionId, discussionId: request.expectedDiscussionId, fromSeq: 1, toSeq: 2, events: [], status: 'available' })
      return Promise.resolve({ branch: { id: 'branch-1' }, timeline: timeline(request.sessionId as SessionId, request.expectedDiscussionId as string).timeline })
    })
    const state: { current?: ReturnType<typeof useTeamReplayPlaybook> } = {}
    await act(async () => { root = createRoot(container); root.render(<Harness sessionId={sessionA} discussionId="discussion-a" onState={(current) => { state.current = current }} />) })
    await act(async () => {
      await state.current?.loadDiff({ fromSeq: 1, toSeq: 2 })
      await state.current?.fork({ branchId: 'branch-1', sourceSeq: 1, reason: 'compare' })
    })
    expect(state.current?.diff?.fromSeq).toBe(1)
    expect(state.current?.branch?.id).toBe('branch-1')
    expect(invoke).toHaveBeenCalledWith('replay:diff', expect.objectContaining({ schemaVersion: 1, sessionId: sessionA, expectedDiscussionId: 'discussion-a', opId: expect.any(String), fromSeq: 1, toSeq: 2 }))
    expect(invoke).toHaveBeenCalledWith('replay:fork', expect.objectContaining({ schemaVersion: 1, sessionId: sessionA, expectedDiscussionId: 'discussion-a', opId: expect.any(String), branchId: 'branch-1' }))
  })

  it('drops stale session responses and exposes CAS conflicts', async () => {
    const timelineResolvers = new Map<SessionId, (value: unknown) => void>()
    invoke.mockImplementation((channel: string, request: { sessionId: SessionId; expectedDiscussionId: string }) => {
      if (channel === 'replay:timeline') return new Promise((resolve) => { timelineResolvers.set(request.sessionId, resolve) })
      if (channel === 'playbook:list') return Promise.resolve(list(request.sessionId, request.expectedDiscussionId))
      return Promise.reject(Object.assign(new Error('Expected current playbook version 1, current version is 2'), { code: 'CONFLICT' }))
    })
    const state: { current?: ReturnType<typeof useTeamReplayPlaybook> } = {}
    await act(async () => { root = createRoot(container); root.render(<Harness sessionId={sessionA} discussionId="discussion-a" onState={(current) => { state.current = current }} />) })
    await act(async () => { root?.render(<Harness sessionId={sessionB} discussionId="discussion-b" onState={(current) => { state.current = current }} />) })
    await act(async () => timelineResolvers.get(sessionA)?.(timeline(sessionA, 'discussion-a')))
    expect(state.current?.timeline?.sessionId).not.toBe(sessionA)
    await act(async () => timelineResolvers.get(sessionB)?.(timeline(sessionB, 'discussion-b')))
    await act(async () => { await expect(state.current?.mutate({ action: 'publish', id: 'playbook-1', expectedVersion: 1 })).rejects.toThrow('current version is 2') })
    expect(state.current?.conflict).toBe(true)
    expect(state.current?.error).toContain('current version is 2')
  })

  it('reuses an operation id for retries but changes it when the payload changes', async () => {
    let mutationAttempt = 0
    invoke.mockImplementation((channel: string, request: { sessionId: SessionId; expectedDiscussionId: string }) => {
      if (channel === 'replay:timeline') return Promise.resolve(timeline(request.sessionId, request.expectedDiscussionId))
      if (channel === 'playbook:list') return Promise.resolve(list(request.sessionId, request.expectedDiscussionId))
      mutationAttempt += 1
      return mutationAttempt === 1 ? Promise.reject(new Error('temporary failure')) : Promise.resolve({ playbook: playbook(request.sessionId, request.expectedDiscussionId) })
    })
    const state: { current?: ReturnType<typeof useTeamReplayPlaybook> } = {}
    await act(async () => { root = createRoot(container); root.render(<Harness sessionId={sessionA} discussionId="discussion-a" onState={(current) => { state.current = current }} />) })
    await act(async () => { await expect(state.current?.mutate({ action: 'publish', id: 'playbook-1', expectedVersion: 1 })).rejects.toThrow('temporary failure') })
    await act(async () => { await state.current?.mutate({ action: 'publish', id: 'playbook-1', expectedVersion: 1 }) })
    await act(async () => { await state.current?.mutate({ action: 'publish', id: 'playbook-1', expectedVersion: 2 }) })
    const calls = invoke.mock.calls.filter(([channel]) => channel === 'playbook:mutate')
    expect(calls).toHaveLength(3)
    expect((calls[0]?.[1] as Record<string, unknown>).opId).toBe((calls[1]?.[1] as Record<string, unknown>).opId)
    expect((calls[1]?.[1] as Record<string, unknown>).opId).not.toBe((calls[2]?.[1] as Record<string, unknown>).opId)
  })

  it('coalesces same-scope refreshes and guards an older same-scope flight after a reload key changes', async () => {
    const timelineResolvers: Array<(value: unknown) => void> = []
    invoke.mockImplementation((channel: string, request: { sessionId: SessionId; expectedDiscussionId: string }) => {
      if (channel === 'replay:timeline') return new Promise((resolve) => { timelineResolvers.push(resolve) })
      return Promise.resolve(list(request.sessionId, request.expectedDiscussionId))
    })
    const state: { current?: ReturnType<typeof useTeamReplayPlaybook> } = {}
    await act(async () => { root = createRoot(container); root.render(<Harness sessionId={sessionA} discussionId="discussion-a" onState={(current) => { state.current = current }} />) })
    const firstRefresh = state.current?.refresh()
    const secondRefresh = state.current?.refresh()
    expect(invoke.mock.calls.filter(([channel]) => channel === 'replay:timeline')).toHaveLength(1)
    await act(async () => { root?.render(<Harness sessionId={sessionA} discussionId="discussion-a" activePlaybookId="playbook-2" onState={(current) => { state.current = current }} />) })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'replay:timeline')).toHaveLength(2)
    timelineResolvers[1]?.(timeline(sessionA, 'discussion-a'))
    await act(async () => undefined)
    expect(state.current?.timeline?.discussionId).toBe('discussion-a')
    timelineResolvers[0]?.(timeline(sessionA, 'discussion-a', 'empty'))
    await act(async () => { await Promise.all([firstRefresh, secondRefresh]) })
    expect(state.current?.timeline?.status).toBe('partial')
  })
})
