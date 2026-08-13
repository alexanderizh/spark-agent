import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any, event: any) => Promise<any>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any, event: any) => Promise<any>) => {
    harness.handlers.set(channel, handler)
  },
}))
vi.mock('../db.js', () => ({ getDatabase: vi.fn() }))
vi.mock('../windows/index.js', () => ({ getMainWindow: vi.fn() }))

import { registerTeamRuntimeIpc } from './registerTeamRuntimeIpc.js'

const sessionId = '11111111-1111-4111-8111-111111111111'

describe('registerTeamRuntimeIpc', () => {
  beforeEach(() => harness.handlers.clear())

  it('registers trusted read and mutation handlers without rewriting scope, opId, or CAS fields', async () => {
    const backend = {
      getTaskGraph: vi.fn(async (id: string) => ({ sessionId: id, discussionId: 'discussion-1', nodes: [], edges: [], syncedAt: 'now' })),
      mutateTaskGraph: vi.fn(async (request: unknown) => ({ snapshot: { request } })),
      getDeliberation: vi.fn(async () => null),
      mutateDeliberation: vi.fn(async (request: unknown) => ({ record: { request }, snapshot: {} })),
    }
    registerTeamRuntimeIpc({ backend: backend as never, authorizeRenderer: () => true })

    await handler('task-graph:get')({ sessionId }, {})
    const taskMutation = {
      sessionId, expectedDiscussionId: 'discussion-1', opId: 'task:transition-1',
      kind: 'node', action: 'transition', id: 'task-1', expectedVersion: 4, status: 'completed',
    }
    await handler('task-graph:mutate')(taskMutation, {})
    await handler('deliberation:get')({ sessionId }, {})
    const deliberationMutation = {
      sessionId, expectedDiscussionId: 'discussion-1', opId: 'decision:evidence-1',
      id: 'decision-1', action: 'evidence', expectedVersion: 2,
      evidence: { summary: 'CI is green', sourceRef: 'run-1', polarity: 'supports' },
    }
    await handler('deliberation:mutate')(deliberationMutation, {})

    expect(backend.getTaskGraph).toHaveBeenCalledWith(sessionId)
    expect(backend.mutateTaskGraph).toHaveBeenCalledWith(taskMutation)
    expect(backend.getDeliberation).toHaveBeenCalledWith(sessionId)
    expect(backend.mutateDeliberation).toHaveBeenCalledWith(deliberationMutation)
  })

  it('rejects an untrusted renderer before any backend access', async () => {
    const backend = {
      getTaskGraph: vi.fn(), mutateTaskGraph: vi.fn(), getDeliberation: vi.fn(), mutateDeliberation: vi.fn(),
    }
    registerTeamRuntimeIpc({ backend: backend as never, authorizeRenderer: () => false })

    await expect(handler('task-graph:get')({ sessionId }, { sender: { id: 9 } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    await expect(handler('deliberation:mutate')({ sessionId }, { sender: { id: 9 } })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(backend.getTaskGraph).not.toHaveBeenCalled()
    expect(backend.mutateDeliberation).not.toHaveBeenCalled()
  })
})

function handler(channel: string) {
  const registered = harness.handlers.get(channel)
  if (registered == null) throw new Error(`Missing handler: ${channel}`)
  return registered
}
