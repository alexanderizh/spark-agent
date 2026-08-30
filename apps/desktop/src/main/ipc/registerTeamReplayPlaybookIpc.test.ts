import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: unknown, event: unknown) => Promise<unknown>>(),
}))
vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (
    channel: string,
    handler: (request: unknown, event: unknown) => Promise<unknown>,
  ) => harness.handlers.set(channel, handler),
}))
vi.mock('../db.js', () => ({ getDatabase: vi.fn() }))
vi.mock('../windows/index.js', () => ({ getMainWindow: vi.fn() }))

import { registerTeamReplayPlaybookIpc } from './registerTeamReplayPlaybookIpc.js'

const sessionId = '11111111-1111-4111-8111-111111111111'

describe('registerTeamReplayPlaybookIpc', () => {
  beforeEach(() => harness.handlers.clear())

  it('registers all replay and playbook handlers and preserves trusted request fields', async () => {
    const backend = {
      getTimeline: vi.fn(async (request: unknown) => request),
      getDiff: vi.fn(async (request: unknown) => request),
      fork: vi.fn(async (request: unknown) => request),
      listPlaybook: vi.fn(async (request: unknown) => request),
      mutate: vi.fn(async (request: unknown) => request),
    }
    registerTeamReplayPlaybookIpc({ backend: backend as never, authorizeRenderer: () => true })
    expect([...harness.handlers.keys()]).toEqual([
      'replay:timeline',
      'replay:diff',
      'replay:fork',
      'playbook:list',
      'playbook:mutate',
    ])
    const request = {
      schemaVersion: 1,
      sessionId,
      expectedDiscussionId: 'discussion-1',
      opId: 'timeline-1',
      limit: 100,
    }
    await harness.handlers.get('replay:timeline')!(request, {})
    expect(backend.getTimeline).toHaveBeenCalledWith(request)
    const mutation = {
      sessionId,
      expectedDiscussionId: 'discussion-1',
      opId: 'archive-1',
      action: 'archive',
      id: 'playbook-1',
      expectedVersion: 1,
    }
    await harness.handlers.get('playbook:mutate')!(mutation, {})
    expect(backend.mutate).toHaveBeenCalledWith(mutation)
  })

  it('rejects untrusted renderers and strict malformed payloads before backend access', async () => {
    const backend = {
      getTimeline: vi.fn(),
      getDiff: vi.fn(),
      fork: vi.fn(),
      listPlaybook: vi.fn(),
      mutate: vi.fn(),
    }
    registerTeamReplayPlaybookIpc({ backend, authorizeRenderer: () => false })
    await expect(
      harness.handlers.get('replay:timeline')!(
        { schemaVersion: 1, sessionId, expectedDiscussionId: 'discussion-1', opId: 'read-1' },
        {},
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(backend.getTimeline).not.toHaveBeenCalled()

    registerTeamReplayPlaybookIpc({ backend: backend as never, authorizeRenderer: () => true })
    await expect(
      harness.handlers.get('playbook:mutate')!(
        {
          sessionId,
          expectedDiscussionId: 'discussion-1',
          opId: 'x',
          action: 'archive',
          id: 'p',
          expectedVersion: 1,
          extra: true,
        },
        {},
      ),
    ).rejects.toThrow()
    expect(backend.mutate).not.toHaveBeenCalled()
  })
})
