import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionService } from '@spark/agent-runtime'
import type { SessionSetWorkflowBindingResponse } from '@spark/protocol'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: unknown) => Promise<unknown>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: unknown) => Promise<unknown>): void => {
    harness.handlers.set(channel, handler)
  },
}))

import { registerSessionWorkflowBindingIpc } from './registerSessionWorkflowBindingIpc.js'

describe('registerSessionWorkflowBindingIpc', () => {
  beforeEach(() => harness.handlers.clear())

  it('emits exactly one config event for changes and none for no-op or preflight failure', async () => {
    const onChanged = vi.fn()
    const setWorkflowBinding = vi
      .fn()
      .mockReturnValueOnce(makeResponse(true))
      .mockReturnValueOnce(makeResponse(false))
      .mockReturnValueOnce(makePreflightFailure())
    const service = { setWorkflowBinding } as unknown as SessionService
    registerSessionWorkflowBindingIpc({ getSessionService: () => service, onChanged })
    const handler = harness.handlers.get('session:set-workflow-binding')
    if (handler == null) throw new Error('expected set binding handler')
    const request = {
      sessionId: 'session-a',
      mode: 'inherit',
      expectedBindingInstanceId: null,
    }

    await handler(request)
    await handler(request)
    await handler(request)

    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(onChanged).toHaveBeenCalledWith('session-a', 'binding-a')
  })
})

function makeResponse(changed: boolean): SessionSetWorkflowBindingResponse {
  return {
    binding: {
      sessionId: 'session-a',
      bindingInstanceId: 'binding-a',
      mode: 'inherit',
      workflowId: null,
      createdAt: '2026-09-12T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    },
    effective: {
      source: 'session-inherit',
      bindingInstanceId: 'binding-a',
      hostAgentId: 'agent-a',
      workflowId: null,
      workflowName: null,
      workflowVersion: null,
      workflowStatus: null,
      workflowEnabled: null,
      executionMode: 'none',
    },
    resumableRun: null,
    changed,
    error: null,
    preflight: { ok: true, issues: [], warnings: [] },
  }
}

function makePreflightFailure(): SessionSetWorkflowBindingResponse {
  return {
    ...makeResponse(false),
    binding: null,
    preflight: {
      ok: false,
      issues: [{ code: 'missing_required_tool', nodeId: 'tool-a', dependencyId: 'Bashx' }],
      warnings: [],
    },
  }
}
