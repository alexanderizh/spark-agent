import { describe, expect, expectTypeOf, it } from 'vitest'
import { IpcSchemaRegistry } from './schemas/index.js'
import {
  SessionWorkflowBindingCreateSchema,
  type SessionSetWorkflowBindingResponse,
} from './session-workflow-binding.js'

describe('session workflow binding IPC schemas', () => {
  it('accepts the three session binding modes', () => {
    const schema = IpcSchemaRegistry['session:set-workflow-binding']
    expect(
      schema.parse({
        sessionId: 'session-a',
        mode: 'inherit',
        expectedBindingInstanceId: null,
      }),
    ).toEqual({ sessionId: 'session-a', mode: 'inherit', expectedBindingInstanceId: null })
    expect(
      schema.parse({
        sessionId: 'session-a',
        mode: 'disabled',
        expectedBindingInstanceId: 'binding-1',
      }),
    ).toEqual({ sessionId: 'session-a', mode: 'disabled', expectedBindingInstanceId: 'binding-1' })
    expect(
      schema.parse({
        sessionId: 'session-a',
        mode: 'override',
        workflowId: 'workflow-a',
        expectedBindingInstanceId: null,
      }),
    ).toEqual({
      sessionId: 'session-a',
      mode: 'override',
      workflowId: 'workflow-a',
      expectedBindingInstanceId: null,
    })
  })

  it('rejects malformed mode combinations and unknown fields', () => {
    const schema = IpcSchemaRegistry['session:set-workflow-binding']
    expect(() =>
      schema.parse({
        sessionId: 'session-a',
        mode: 'override',
        expectedBindingInstanceId: null,
      }),
    ).toThrow()
    expect(() =>
      schema.parse({
        sessionId: 'session-a',
        mode: 'disabled',
        expectedBindingInstanceId: null,
        workflowId: 'workflow-a',
      }),
    ).toThrow()
    expect(() =>
      IpcSchemaRegistry['session:get-workflow-binding'].parse({
        sessionId: 'session-a',
        unexpected: true,
      }),
    ).toThrow()
  })

  it('defines and validates atomic-create binding options on session:create', () => {
    expect(
      SessionWorkflowBindingCreateSchema.parse({ mode: 'override', workflowId: 'workflow-a' }),
    ).toEqual({ mode: 'override', workflowId: 'workflow-a' })
    expect(() => SessionWorkflowBindingCreateSchema.parse({ mode: 'override' })).toThrow()
    expect(() =>
      SessionWorkflowBindingCreateSchema.parse({ mode: 'inherit', workflowId: 'workflow-a' }),
    ).toThrow()

    const sessionCreateSchema = IpcSchemaRegistry['session:create']
    expect(
      sessionCreateSchema.parse({
        providerProfileId: '00000000-0000-4000-8000-000000000001',
        workflowBinding: { mode: 'disabled' },
      }),
    ).toHaveProperty('workflowBinding', { mode: 'disabled' })
  })

  it('requires localized preflight details in set responses', () => {
    expectTypeOf<SessionSetWorkflowBindingResponse>().toMatchTypeOf<{
      preflight: {
        issues: Array<{ code: string; params?: Record<string, string | number | boolean> }>
        warnings: Array<{ code: string; params?: Record<string, string | number | boolean> }>
      }
    }>()

    const response = {
      binding: {
        sessionId: 'session-a',
        bindingInstanceId: 'binding-a',
        mode: 'override',
        workflowId: 'workflow-a',
        createdAt: '2026-09-12T00:00:00.000Z',
        updatedAt: '2026-09-12T00:00:00.000Z',
      },
      effective: {
        source: 'session-override',
        bindingInstanceId: 'binding-a',
        hostAgentId: 'agent-a',
        workflowId: 'workflow-a',
        workflowName: 'A',
        workflowVersion: '1.0.0',
        workflowStatus: 'active',
        workflowEnabled: true,
        executionMode: 'workflow_run',
      },
      resumableRun: null,
      changed: true,
      error: null,
      preflight: {
        ok: false,
        issues: [{ code: 'missing_required_tool', params: { dependencyName: 'tool-a' } }],
        warnings: [],
      },
    } satisfies SessionSetWorkflowBindingResponse

    expect(response.preflight.issues[0]?.params).toEqual({ dependencyName: 'tool-a' })
  })
})
