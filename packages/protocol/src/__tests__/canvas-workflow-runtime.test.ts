import { describe, expect, it } from 'vitest'
import { CanvasWorkflowRuntimeIpcSchemaRegistry } from '../canvas-workflow-runtime.js'

describe('canvas workflow runtime IPC validation', () => {
  it('requires a stable idempotency key when creating a run', () => {
    expect(() =>
      CanvasWorkflowRuntimeIpcSchemaRegistry['canvas:workflow:run:create'].parse({
        workflowId: 'workflow-1',
        projectId: 'project-1',
        inputs: {},
        exposedParams: {},
      }),
    ).toThrow(/idempotencyKey/)

    const parsed =
      CanvasWorkflowRuntimeIpcSchemaRegistry['canvas:workflow:run:create'].parse({
        workflowId: 'workflow-1',
        workflowVersion: 3,
        projectId: 'project-1',
        inputs: { theme: '海边日落' },
        exposedParams: { count: 2 },
        idempotencyKey: 'request-1',
      })
    expect(parsed.idempotencyKey).toBe('request-1')
    expect(parsed.workflowVersion).toBe(3)
  })

  it('bounds history pagination', () => {
    expect(() =>
      CanvasWorkflowRuntimeIpcSchemaRegistry['canvas:workflow:run:list'].parse({
        projectId: 'project-1',
        limit: 201,
      }),
    ).toThrow(/limit/)
    expect(() =>
      CanvasWorkflowRuntimeIpcSchemaRegistry['canvas:workflow:version:list'].parse({
        workflowId: 'workflow-1',
        offset: -1,
      }),
    ).toThrow(/offset/)
  })

  it('accepts structured step updates but rejects terminal blocked states', () => {
    const parsed =
      CanvasWorkflowRuntimeIpcSchemaRegistry['canvas:workflow:run:step-update'].parse({
        runId: 'run-1',
        nodeId: 'generate',
        status: 'completed',
        taskId: 'task-1',
        output: { assetId: 'asset-1' },
      })
    expect(parsed.status).toBe('completed')

    expect(() =>
      CanvasWorkflowRuntimeIpcSchemaRegistry['canvas:workflow:run:step-update'].parse({
        runId: 'run-1',
        nodeId: 'generate',
        status: 'blocked',
      }),
    ).toThrow(/status/)
  })
})
