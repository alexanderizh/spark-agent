import { describe, expect, it, vi } from 'vitest'
import type { SessionRow } from '@spark/storage'
import type { SessionId } from '@spark/protocol'
import type { SessionService } from '../session.service.js'
import { SessionDispatch, SessionDispatchAuthorization } from './session-dispatch.js'

const input = {
  sourceId: 'source',
  requestKey: 'fix-download',
  title: 'Fix download',
  task: 'Reproduce the failure and fix it.',
}

function setup() {
  const source: SessionRow = {
    id: 'source',
    kind: 'agent',
    title: 'Source',
    status: 'running',
    project_id: 'project',
    workspace_ids_json: '["project"]',
    rule_bundle_id: null,
    permission_profile_id: null,
    provider_profile_id: 'provider',
    model_id: 'model',
    agent_adapter: 'codex',
    agent_id: 'agent',
    permission_mode: 'codex-full-access',
    chat_mode: 'agent',
    reasoning_effort: 'medium',
    pinned_at: null,
    archived_at: null,
    turn_count: 1,
    logical_message_count: 1,
    metadata_json: '{}',
    created_at: 'now',
    updated_at: 'now',
  }
  const rows = new Map([[source.id, source]])
  const metadata = new Map<string, Record<string, unknown>>()
  const sessions = {
    get: (id: string) => rows.get(id) ?? null,
    getWorkspaceIds: () => ['project'],
    getMetadata: (id: string) => metadata.get(id) ?? {},
    patchMetadata: (id: string, patch: Record<string, unknown>) => {
      const next = { ...metadata.get(id), ...patch }
      metadata.set(id, next)
      return next
    },
  }
  const createSession = vi.fn<SessionService['createSession']>(async (params, dispatch) => {
    if (dispatch == null) throw new Error('Dispatch identity missing')
    const { sessionId, dispatchFingerprint } = dispatch
    rows.set(sessionId, { ...source, id: sessionId, title: params.title ?? '', status: 'idle' })
    sessions.patchMetadata(sessionId, { dispatchFingerprint })
    const id = sessionId as SessionId
    return {
      sessionId: id,
      createdAt: 'now',
      session: {
        id,
        title: params.title ?? '',
        projectId: 'project',
        workspaceIds: ['project'],
        providerProfileId: 'provider',
        modelId: 'model',
        agentId: 'agent',
        agentAdapter: 'codex',
        permissionMode: 'codex-default',
        chatMode: 'agent',
        reasoningEffort: 'medium',
        status: 'idle',
        pinnedAt: null,
        archivedAt: null,
        createdAt: 'now',
        updatedAt: 'now',
        messageCount: 0,
      },
    }
  })
  const submitTurn = vi.fn<SessionService['submitTurn']>(async (_params, options) => {
    options?.onAccepted?.('turn-1')
    return { accepted: true, started: false, turnId: 'turn-1' }
  })
  const onCreated = vi.fn()
  const newDispatcher = () =>
    new SessionDispatch(sessions, { createSession, submitTurn }, onCreated)
  return {
    dispatch: newDispatcher(),
    newDispatcher,
    createSession,
    submitTurn,
    onCreated,
    sessions,
  }
}

describe('one-shot session dispatch', () => {
  it('creates a standalone session, uses safer permissions, and submits only the assignment', async () => {
    const f = setup()
    const result = await f.dispatch.dispatch(input)
    expect(result).toMatchObject({ accepted: true, turnId: 'turn-1' })
    expect(result.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(f.createSession).toHaveBeenCalledWith(
      {
        title: input.title,
        workspaceId: 'project',
        agentId: 'agent',
        providerProfileId: 'provider',
        modelId: 'model',
        agentAdapter: 'codex',
        chatMode: 'agent',
        permissionMode: 'codex-default',
        workflowBinding: { mode: 'disabled' },
      },
      expect.objectContaining({ sessionId: result.sessionId }),
    )
    expect(f.submitTurn).toHaveBeenCalledWith(
      { sessionId: result.sessionId, message: input.task },
      expect.anything(),
    )
    expect(f.onCreated).toHaveBeenCalledWith(result.sessionId)
    expect(f.sessions.getMetadata('source')).toEqual({})
  })

  it('reuses the same session after a pre-acceptance failure and rejects changed content', async () => {
    const f = setup()
    f.submitTurn.mockRejectedValueOnce(new Error('write failed'))
    const failed = await f.dispatch.dispatch(input)
    expect(failed).toMatchObject({ accepted: false, sessionId: expect.any(String) })
    await expect(f.newDispatcher().dispatch({ ...input, task: 'Different task' })).rejects.toThrow(
      'different task',
    )
    await expect(f.newDispatcher().dispatch(input)).resolves.toEqual({
      accepted: true,
      sessionId: failed.sessionId,
      turnId: 'turn-1',
    })
    expect(f.createSession).toHaveBeenCalledTimes(1)
    expect(f.submitTurn).toHaveBeenCalledTimes(2)
  })

  it('reuses a committed session if creation failed while preparing its reply', async () => {
    const f = setup()
    const create = f.createSession.getMockImplementation()!
    f.createSession.mockImplementationOnce(async (...args) => {
      await create(...args)
      throw new Error('could not build summary')
    })
    const failed = await f.dispatch.dispatch(input)
    expect(failed).toMatchObject({ accepted: false, sessionId: expect.any(String) })
    expect(f.submitTurn).not.toHaveBeenCalled()
    await expect(f.newDispatcher().dispatch(input)).resolves.toEqual({
      accepted: true,
      sessionId: failed.sessionId,
      turnId: 'turn-1',
    })
    expect(f.createSession).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent and later calls even when the acceptance reply is lost', async () => {
    const f = setup()
    f.submitTurn.mockImplementationOnce(async (_params, options) => {
      options?.onAccepted?.('turn-1')
      throw new Error('after acceptance')
    })
    const [first, second] = await Promise.all([
      f.dispatch.dispatch(input),
      f.dispatch.dispatch(input),
    ])
    expect(first).toMatchObject({ accepted: true, turnId: 'turn-1' })
    expect(second).toEqual(first)
    await expect(f.newDispatcher().dispatch(input)).resolves.toEqual(first)
    expect(f.createSession).toHaveBeenCalledTimes(1)
    expect(f.submitTurn).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown and remote-origin sources', async () => {
    const f = setup()
    await expect(f.dispatch.dispatch({ ...input, sourceId: 'unknown' })).rejects.toThrow(
      'active local agent session',
    )
    f.sessions.patchMetadata('source', { remoteAgentLinkId: 'remote-link' })
    await expect(f.dispatch.dispatch(input)).rejects.toThrow('active local agent session')
    expect(f.createSession).not.toHaveBeenCalled()
  })

  it('binds authorization to the source session', () => {
    const auth = new SessionDispatchAuthorization()
    const token = auth.issue('source')
    expect(() => auth.verify('source', token)).not.toThrow()
    expect(() => auth.verify('another', token)).toThrow('authorization')
    expect(() => auth.verify('source', undefined)).toThrow('authorization')
  })
})
