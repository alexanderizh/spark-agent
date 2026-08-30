import { describe, expect, it, vi } from 'vitest'
import type { CanvasWorkflowRun } from '@spark/protocol'
import { executeCanvasWorkflowCanvasStep } from './canvasWorkflowCanvasExecutor'

const run = {
  id: 'run-1',
  workflowId: 'workflow-1',
  workflowVersion: 3,
  projectId: 'project-1',
  status: 'running',
  inputs: { theme: '海边日落', product: 'image-node-1' },
  exposedParams: { count: 4 },
  outputs: {},
  error: null,
  idempotencyKey: 'request-1',
  createdAt: '',
  startedAt: null,
  finishedAt: null,
  updatedAt: '',
  steps: [],
} satisfies CanvasWorkflowRun

describe('executeCanvasWorkflowCanvasStep', () => {
  it('resolves contract input values without creating a task', async () => {
    const result = await executeCanvasWorkflowCanvasStep(
      {
        run,
        step: {
          nodeId: 'input-node',
          kind: 'canvas_input',
          label: '主题',
          config: {},
          dependsOnNodeIds: [],
          incomingEdges: [],
          outgoingEdges: [],
        },
        runtimeStep: {} as never,
        outputsByNodeId: new Map(),
      },
      {
        contract: {
          inputs: [
            {
              id: 'theme',
              name: '主题',
              valueType: 'text',
              required: true,
              targetNodeId: 'input-node',
            },
          ],
          outputs: [],
          exposedParams: [],
        },
        createOperation: vi.fn(),
        waitForTask: vi.fn(),
        markProvenance: vi.fn(),
      },
    )

    expect(result.output).toEqual({ value: '海边日落', inputId: 'theme' })
  })

  it('applies exposed parameter paths and waits for materialized task outputs', async () => {
    const createOperation = vi.fn(async () => ({ id: 'task-1' }))
    const waitForTask = vi.fn(async () => ({
      id: 'task-1',
      outputNodeIds: ['node-1'],
      outputAssetIds: ['asset-1'],
    }))
    const markProvenance = vi.fn(async () => undefined)
    const result = await executeCanvasWorkflowCanvasStep(
      {
        run,
        step: {
          nodeId: 'generate',
          kind: 'canvas_operation',
          label: '生成主视觉',
          config: {
            operation: 'text_to_image',
            prompt: '商业摄影',
            modelParams: { size: '1024x1024', count: 1 },
          },
          dependsOnNodeIds: ['input-node'],
          incomingEdges: [],
          outgoingEdges: [],
        },
        runtimeStep: {} as never,
        outputsByNodeId: new Map([['input-node', { value: '柔和侧光' }]]),
      },
      {
        contract: {
          inputs: [
            {
              id: 'theme',
              name: '主题',
              valueType: 'text',
              required: true,
              targetNodeId: 'generate',
            },
            {
              id: 'product',
              name: '产品图',
              valueType: 'image',
              required: true,
              targetNodeId: 'generate',
            },
          ],
          outputs: [],
          exposedParams: [
            {
              id: 'count',
              name: '数量',
              valueType: 'number',
              nodeId: 'generate',
              path: 'modelParams.count',
            },
          ],
        },
        createOperation,
        waitForTask,
        markProvenance,
      },
    )

    expect(createOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'text_to_image',
        prompt: '商业摄影\n\n海边日落\n\n柔和侧光',
        inputNodeIds: ['image-node-1'],
        modelParams: { size: '1024x1024', count: 4 },
      }),
    )
    expect(markProvenance).toHaveBeenCalledWith(
      expect.objectContaining({ outputNodeIds: ['node-1'], outputAssetIds: ['asset-1'] }),
      expect.objectContaining({ run }),
    )
    expect(result).toEqual({
      taskId: 'task-1',
      output: { taskId: 'task-1', outputNodeIds: ['node-1'], outputAssetIds: ['asset-1'] },
    })
  })

  it('emits selected canvas nodes from media input nodes', async () => {
    const result = await executeCanvasWorkflowCanvasStep(
      {
        run,
        step: {
          nodeId: 'input-node',
          kind: 'canvas_input',
          label: '产品图',
          config: {},
          dependsOnNodeIds: [],
          incomingEdges: [],
          outgoingEdges: [],
        },
        runtimeStep: {} as never,
        outputsByNodeId: new Map(),
      },
      {
        contract: {
          inputs: [
            {
              id: 'product',
              name: '产品图',
              valueType: 'image',
              required: true,
              targetNodeId: 'input-node',
            },
          ],
          outputs: [],
          exposedParams: [],
        },
        createOperation: vi.fn(),
        waitForTask: vi.fn(),
        markProvenance: vi.fn(),
      },
    )

    expect(result.output).toEqual({
      value: 'image-node-1',
      inputId: 'product',
      outputNodeIds: ['image-node-1'],
    })
  })

  it('binds parent handles and exposed parameters into a persisted subworkflow run', async () => {
    const executeSubworkflow = vi.fn(async () => ({
      runId: 'child-run-1',
      workflowVersion: 2,
      outputs: { image: { outputNodeIds: ['child-output'] } },
    }))
    const result = await executeCanvasWorkflowCanvasStep(
      {
        run,
        step: {
          nodeId: 'subworkflow',
          kind: 'canvas_subworkflow',
          label: '生成镜头组',
          config: {
            workflowId: 'child-workflow',
            workflowVersion: 2,
            inputs: { style: 'cinematic' },
            exposedParams: { count: 2 },
          },
          dependsOnNodeIds: ['reference-node'],
          incomingEdges: [
            {
              id: 'edge-reference',
              sourceNodeId: 'reference-node',
              targetNodeId: 'subworkflow',
              sourceHandle: 'image',
              targetHandle: 'reference',
            },
          ],
          outgoingEdges: [],
        },
        runtimeStep: { attempt: 1 } as never,
        outputsByNodeId: new Map([['reference-node', { image: 'asset-1' }]]),
      },
      {
        contract: {
          inputs: [
            {
              id: 'theme',
              name: '主题',
              valueType: 'text',
              required: true,
              targetNodeId: 'subworkflow',
              targetHandle: 'prompt',
            },
          ],
          outputs: [],
          exposedParams: [
            {
              id: 'count',
              name: '数量',
              valueType: 'number',
              nodeId: 'subworkflow',
              path: 'exposedParams.count',
            },
          ],
        },
        createOperation: vi.fn(),
        waitForTask: vi.fn(),
        markProvenance: vi.fn(),
        executeSubworkflow,
      },
    )

    expect(executeSubworkflow).toHaveBeenCalledWith({
      workflowId: 'child-workflow',
      workflowVersion: 2,
      inputs: { style: 'cinematic', prompt: '海边日落', reference: 'asset-1' },
      exposedParams: { count: 4 },
      idempotencyKey: 'run-1:subworkflow:1',
    })
    expect(result.output).toEqual({
      childRunId: 'child-run-1',
      childWorkflowId: 'child-workflow',
      childWorkflowVersion: 2,
      outputs: { image: { outputNodeIds: ['child-output'] } },
    })
  })
})
