import { beforeEach, describe, expect, it, vi } from 'vitest'
const harness = vi.hoisted(() => ({ handlers: new Map<string, (request: any, event: any) => Promise<any>>() }))
vi.mock('./typed-ipc.js', () => ({ typedIpcHandle: (channel: string, handler: (request: any, event: any) => Promise<any>) => harness.handlers.set(channel, handler) }))
vi.mock('../db.js', () => ({ getDatabase: vi.fn() }))
vi.mock('../windows/index.js', () => ({ getMainWindow: vi.fn() }))
import { registerTeamEvidenceCostIpc } from './registerTeamEvidenceCostIpc.js'

describe('registerTeamEvidenceCostIpc', () => {
  beforeEach(() => harness.handlers.clear())
  it('keeps trusted session, discussion, operation and CAS fields unchanged', async () => {
    const backend = { getSnapshot: vi.fn(), mutate: vi.fn(async (request: unknown) => request) }
    registerTeamEvidenceCostIpc({ backend: backend as never, authorizeRenderer: () => true })
    const request = { sessionId: '11111111-1111-4111-8111-111111111111', expectedDiscussionId: 'discussion-1', opId: 'usage-1', kind: 'usage', action: 'record', id: 'usage-1', status: 'unknown' }
    await harness.handlers.get('evidence-cost:mutate')!(request, {})
    expect(backend.mutate).toHaveBeenCalledWith(request)
  })
  it('rejects an untrusted renderer before backend access', async () => {
    const backend = { getSnapshot: vi.fn(), mutate: vi.fn() }
    registerTeamEvidenceCostIpc({ backend: backend as never, authorizeRenderer: () => false })
    await expect(harness.handlers.get('evidence-cost:get')!({ sessionId: '11111111-1111-4111-8111-111111111111', expectedDiscussionId: 'discussion-1' }, {})).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(backend.getSnapshot).not.toHaveBeenCalled()
  })

  it('parses discussion scope and forwards it to the backend', async () => {
    const backend = { getSnapshot: vi.fn(async () => ({ discussionId: 'discussion-1' })), mutate: vi.fn() }
    registerTeamEvidenceCostIpc({ backend: backend as never, authorizeRenderer: () => true })
    const request = { sessionId: '11111111-1111-4111-8111-111111111111', expectedDiscussionId: 'discussion-1' }
    await harness.handlers.get('evidence-cost:get')!(request, {})
    expect(backend.getSnapshot).toHaveBeenCalledWith(request.sessionId, request.expectedDiscussionId)
  })
})
