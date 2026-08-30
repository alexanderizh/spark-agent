import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({ handlers: new Map<string, (request: any, event: any) => Promise<any>>() }))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any, event: any) => Promise<any>) => harness.handlers.set(channel, handler),
}))
vi.mock('../db.js', () => ({ getDatabase: vi.fn() }))

import { registerTeamP1Ipc } from './registerTeamP1Ipc.js'

describe('registerTeamP1Ipc', () => {
  beforeEach(() => harness.handlers.clear())

  it('forwards the renderer operation id unchanged for retry-safe mutation', async () => {
    const backend = {
      getSnapshot: vi.fn(),
      mutate: vi.fn((request: unknown) => ({ request })),
    }
    registerTeamP1Ipc({ backend: backend as never, authorizeRenderer: () => true })
    const mutation = {
      sessionId: '11111111-1111-4111-8111-111111111111', expectedDiscussionId: 'discussion-1', opId: 'team-p1:retry-1',
      kind: 'gate', action: 'approve', id: 'gate-1', expectedVersion: 1,
    }
    await harness.handlers.get('team-p1:mutate')!(mutation, {})
    expect(backend.mutate).toHaveBeenCalledWith(mutation)
  })
})
