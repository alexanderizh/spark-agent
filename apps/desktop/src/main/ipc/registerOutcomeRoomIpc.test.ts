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

import { registerOutcomeRoomIpc } from './registerOutcomeRoomIpc.js'

describe('registerOutcomeRoomIpc', () => {
  beforeEach(() => harness.handlers.clear())

  it('registers get and mutate handlers that forward only the typed session request', async () => {
    const backend = {
      getSnapshot: vi.fn(async (sessionId: string) => ({ sessionId, records: [] })),
      mutate: vi.fn(async (request: unknown) => ({ request })),
    }
    registerOutcomeRoomIpc({ backend: backend as never, authorizeRenderer: () => true })

    await handler('outcome-room:get')({ sessionId: 'session-1' }, {})
    await handler('outcome-room:mutate')(
      {
        sessionId: 'session-1',
        expectedDiscussionId: 'discussion-1',
        expectedRecordId: 'record-1',
        action: 'confirm',
        logicalKey: 'goal',
        expectedVersion: 1,
      },
      {},
    )

    expect(backend.getSnapshot).toHaveBeenCalledWith('session-1')
    expect(backend.mutate).toHaveBeenCalledWith({
      sessionId: 'session-1',
      expectedDiscussionId: 'discussion-1',
      expectedRecordId: 'record-1',
      action: 'confirm',
      logicalKey: 'goal',
      expectedVersion: 1,
    })
  })

  it('rejects an untrusted renderer before reading room data', async () => {
    const backend = {
      getSnapshot: vi.fn(),
      mutate: vi.fn(),
    }
    registerOutcomeRoomIpc({ backend: backend as never, authorizeRenderer: () => false })

    await expect(
      handler('outcome-room:get')({ sessionId: 'session-1' }, { sender: { id: 9 } }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(backend.getSnapshot).not.toHaveBeenCalled()
  })
})

function handler(channel: string) {
  const registered = harness.handlers.get(channel)
  if (registered == null) throw new Error(`Missing handler: ${channel}`)
  return registered
}
