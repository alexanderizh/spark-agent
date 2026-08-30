// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@spark/protocol'
import {
  useTeamReplayPlaybook,
  type ReplayTimeline,
  type TeamReplayPlaybookListResponse,
} from './useTeamReplayPlaybook'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessionA = '11111111-1111-4111-8111-111111111111' as SessionId
const sessionB = '22222222-2222-4222-8222-222222222222' as SessionId

const timeline = (sessionId: SessionId, discussionId: string): { timeline: ReplayTimeline } => ({
  timeline: {
    sessionId,
    discussionId,
    events: [
      {
        id: 'event-1',
        sessionId,
        roomId: `team-room:${sessionId}`,
        discussionId,
        sourceType: 'task',
        sourceId: 'task-1',
        seq: 1,
        time: '2026-08-14T00:00:00.000Z',
        actor: 'agent-a',
        action: 'started',
        before: null,
        after: { status: 'running' },
        evidenceRefs: [],
      },
    ],
    cursor: null,
    nextCursor: '1',
    status: 'partial',
    syncedAt: '2026-08-14T00:00:00.000Z',
  },
})

const list = (sessionId: SessionId, discussionId: string): TeamReplayPlaybookListResponse => ({
  playbook: {
    id: 'playbook-1',
    sessionId,
    roomId: `team-room:${sessionId}`,
    discussionId,
    version: 1,
    status: 'proposed',
    name: 'Release flow',
    graph: {},
    roles: {},
    handoffRules: {},
    gateRules: {},
    deliberationRules: {},
    createdBy: 'agent-a',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  },
  versions: [],
  applications: [],
})

function Harness({
  sessionId,
  discussionId,
  onState,
}: {
  sessionId: SessionId
  discussionId: string
  onState: (state: ReturnType<typeof useTeamReplayPlaybook>) => void
}) {
  onState(useTeamReplayPlaybook(sessionId, discussionId, 'playbook-1'))
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

  it('loads timeline and playbook with typed scope and refreshes the active scope', async () => {
    invoke.mockImplementation((channel: string) =>
      channel === 'replay:timeline'
        ? Promise.resolve(timeline(sessionA, 'discussion-a'))
        : Promise.resolve(list(sessionA, 'discussion-a')),
    )
    const state: { current?: ReturnType<typeof useTeamReplayPlaybook> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(
        <Harness
          sessionId={sessionA}
          discussionId="discussion-a"
          onState={(current) => {
            state.current = current
          }}
        />,
      )
    })
    await act(async () => {
      await Promise.all([state.current?.refresh(), state.current?.refresh()])
    })
    expect(invoke.mock.calls.filter(([channel]) => channel === 'replay:timeline')).toHaveLength(2)
    expect(state.current?.timeline?.status).toBe('partial')
    expect(state.current?.playbook?.name).toBe('Release flow')
    expect(invoke.mock.calls.find(([channel]) => channel === 'replay:timeline')?.[1]).toMatchObject(
      { schemaVersion: 1, sessionId: sessionA, expectedDiscussionId: 'discussion-a' },
    )
  })

  it('drops old session responses and exposes a precise CAS conflict', async () => {
    const resolvers = new Map<SessionId, (value: unknown) => void>()
    invoke.mockImplementation((channel: string, request: { sessionId: SessionId }) =>
      channel === 'replay:timeline'
        ? new Promise((resolve) => {
            resolvers.set(request.sessionId, resolve)
          })
        : Promise.resolve(
            list(
              request.sessionId,
              request.sessionId === sessionA ? 'discussion-a' : 'discussion-b',
            ),
          ),
    )
    const state: { current?: ReturnType<typeof useTeamReplayPlaybook> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(
        <Harness
          sessionId={sessionA}
          discussionId="discussion-a"
          onState={(current) => {
            state.current = current
          }}
        />,
      )
    })
    await act(async () => {
      root?.render(
        <Harness
          sessionId={sessionB}
          discussionId="discussion-b"
          onState={(current) => {
            state.current = current
          }}
        />,
      )
    })
    await act(async () => resolvers.get(sessionA)?.(timeline(sessionA, 'discussion-a')))
    expect(state.current?.timeline?.sessionId).not.toBe(sessionA)
    await act(async () => resolvers.get(sessionB)?.(timeline(sessionB, 'discussion-b')))
    await act(async () => {
      invoke.mockImplementationOnce(() =>
        Promise.reject(new Error('Expected current playbook version 1, current version is 2')),
      )
      await expect(
        state.current?.mutate({ action: 'publish', id: 'playbook-1', expectedVersion: 1 }),
      ).rejects.toThrow('Expected current playbook version')
    })
    expect(state.current?.conflict).toBe(true)
    expect(state.current?.error).toContain('current version is 2')
  })

  it('reuses a stable operation id when a CAS mutation is retried', async () => {
    let attempt = 0
    invoke.mockImplementation((channel: string) => {
      if (channel === 'replay:timeline') return Promise.resolve(timeline(sessionA, 'discussion-a'))
      if (channel === 'playbook:list') return Promise.resolve(list(sessionA, 'discussion-a'))
      attempt += 1
      return attempt === 1
        ? Promise.reject(new Error('Expected current playbook version 1, current version is 2'))
        : Promise.resolve(list(sessionA, 'discussion-a'))
    })
    const state: { current?: ReturnType<typeof useTeamReplayPlaybook> } = {}
    await act(async () => {
      root = createRoot(container)
      root.render(
        <Harness
          sessionId={sessionA}
          discussionId="discussion-a"
          onState={(current) => {
            state.current = current
          }}
        />,
      )
    })
    await act(async () => {
      await expect(
        state.current?.mutate({ action: 'publish', id: 'playbook-1', expectedVersion: 1 }),
      ).rejects.toThrow('Expected current playbook version')
      await state.current?.mutate({ action: 'publish', id: 'playbook-1', expectedVersion: 1 })
    })
    const calls = invoke.mock.calls.filter(([channel]) => channel === 'playbook:mutate')
    expect(calls).toHaveLength(2)
    expect((calls[0]?.[1] as Record<string, unknown>).opId).toBe(
      (calls[1]?.[1] as Record<string, unknown>).opId,
    )
  })
})
