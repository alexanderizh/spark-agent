import { describe, expect, it } from 'vitest'
import type { CanvasWorkflowPackage } from '../canvas-workflow.js'
import { compileCanvasWorkflowPackage } from '../canvas-workflow-compiler.js'

function workflowPackage(overrides: Partial<CanvasWorkflowPackage> = {}): CanvasWorkflowPackage {
  return {
    schemaVersion: 1,
    graph: {
      nodes: [
        {
          id: 'input',
          kind: 'canvas_input',
          label: '主题',
          position: { x: 0, y: 0 },
          config: {},
        },
        {
          id: 'generate',
          kind: 'canvas_operation',
          label: '生成图片',
          position: { x: 240, y: 0 },
          config: { operation: 'text_to_image' },
        },
        {
          id: 'output',
          kind: 'canvas_output',
          label: '主视觉',
          position: { x: 480, y: 0 },
          config: {},
        },
      ],
      edges: [
        {
          id: 'edge-input-generate',
          sourceNodeId: 'input',
          targetNodeId: 'generate',
          sourceHandle: 'text',
          targetHandle: 'prompt',
        },
        {
          id: 'edge-generate-output',
          sourceNodeId: 'generate',
          targetNodeId: 'output',
          sourceHandle: 'image',
          targetHandle: 'value',
        },
      ],
    },
    contract: {
      inputs: [
        {
          id: 'input-theme',
          name: '主题',
          valueType: 'text',
          required: true,
          targetNodeId: 'input',
        },
      ],
      outputs: [
        {
          id: 'output-image',
          name: '主视觉',
          valueType: 'image',
          sourceNodeId: 'output',
        },
      ],
      exposedParams: [
        {
          id: 'param-count',
          name: '数量',
          valueType: 'number',
          nodeId: 'generate',
          path: 'modelParams.count',
          defaultValue: 1,
        },
      ],
    },
    dependencies: {
      modelCapabilities: ['text_to_image'],
      canvasNodeKinds: ['text', 'operation', 'image'],
    },
    ...overrides,
  }
}

describe('compileCanvasWorkflowPackage', () => {
  it('produces a stable frozen execution plan and preserves edge handles', () => {
    const result = compileCanvasWorkflowPackage(workflowPackage())

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.plan.nodeOrder).toEqual(['input', 'generate', 'output'])
    expect(result.plan.steps[1]).toMatchObject({
      nodeId: 'generate',
      dependsOnNodeIds: ['input'],
      incomingEdges: [expect.objectContaining({ sourceHandle: 'text', targetHandle: 'prompt' })],
    })
    expect(Object.isFrozen(result.plan)).toBe(true)
    expect(Object.isFrozen(result.plan.steps)).toBe(true)
    expect(Object.isFrozen(result.plan.steps[1]!.incomingEdges[0])).toBe(true)
  })

  it('reports duplicate graph and contract ids', () => {
    const base = workflowPackage()
    const firstNode = base.graph.nodes[0]!
    const firstEdge = base.graph.edges[0]!
    const firstInput = base.contract.inputs[0]!
    const firstOutput = base.contract.outputs[0]!
    const result = compileCanvasWorkflowPackage({
      ...base,
      graph: {
        nodes: [...base.graph.nodes, { ...firstNode }],
        edges: [...base.graph.edges, { ...firstEdge }],
      },
      contract: {
        ...base.contract,
        outputs: [{ ...firstOutput, id: firstInput.id }],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['duplicate_node_id', 'duplicate_edge_id', 'duplicate_contract_id']),
    )
  })

  it('reports dangling edges and contract references', () => {
    const base = workflowPackage()
    const firstInput = base.contract.inputs[0]!
    const firstOutput = base.contract.outputs[0]!
    const firstParam = base.contract.exposedParams[0]!
    const result = compileCanvasWorkflowPackage({
      ...base,
      graph: {
        ...base.graph,
        edges: [
          ...base.graph.edges,
          {
            id: 'dangling-edge',
            sourceNodeId: 'missing-source',
            targetNodeId: 'missing-target',
          },
        ],
      },
      contract: {
        inputs: [{ ...firstInput, targetNodeId: 'missing-input-target' }],
        outputs: [{ ...firstOutput, sourceNodeId: 'missing-output-source' }],
        exposedParams: [{ ...firstParam, nodeId: 'missing-param-node' }],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'edge_source_missing',
        'edge_target_missing',
        'input_target_missing',
        'output_source_missing',
        'param_node_missing',
      ]),
    )
  })

  it('rejects canvas operation nodes that do not map to a supported operation', () => {
    const base = workflowPackage()
    const result = compileCanvasWorkflowPackage({
      ...base,
      graph: {
        ...base.graph,
        nodes: base.graph.nodes.map((node) =>
          node.id === 'generate' ? { ...node, config: { operation: 'delete_everything' } } : node,
        ),
      },
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'operation_invalid', nodeId: 'generate' }),
    )
  })

  it('rejects cycles and returns the involved node ids', () => {
    const base = workflowPackage()
    const result = compileCanvasWorkflowPackage({
      ...base,
      graph: {
        ...base.graph,
        edges: [
          ...base.graph.edges,
          {
            id: 'edge-output-input',
            sourceNodeId: 'output',
            targetNodeId: 'input',
          },
        ],
      },
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'graph_cycle',
        nodeIds: expect.arrayContaining(['input', 'generate', 'output']),
      }),
    )
  })

  it('rejects direct and nested subworkflow recursion', () => {
    const child = workflowPackage({
      graph: {
        nodes: [
          {
            id: 'call-root',
            kind: 'canvas_subworkflow',
            label: '调用根工作流',
            position: { x: 0, y: 0 },
            config: { workflowId: 'root', workflowVersion: 1 },
          },
        ],
        edges: [],
      },
      contract: { inputs: [], outputs: [], exposedParams: [] },
    })
    const root = workflowPackage({
      graph: {
        nodes: [
          {
            id: 'call-child',
            kind: 'canvas_subworkflow',
            label: '调用子工作流',
            position: { x: 0, y: 0 },
            config: { workflowId: 'child', workflowVersion: 1 },
          },
        ],
        edges: [],
      },
      contract: { inputs: [], outputs: [], exposedParams: [] },
    })

    const result = compileCanvasWorkflowPackage(root, {
      workflowId: 'root',
      resolveSubworkflowPackage: (workflowId) => (workflowId === 'child' ? child : null),
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'subworkflow_recursion',
        workflowIds: ['root', 'child', 'root'],
      }),
    )
  })

  it('reports unresolved subworkflow references before execution', () => {
    const base = workflowPackage()
    const result = compileCanvasWorkflowPackage(
      {
        ...base,
        graph: {
          nodes: [
            {
              id: 'call-missing',
              kind: 'canvas_subworkflow',
              label: '缺失工作流',
              position: { x: 0, y: 0 },
              config: { workflowId: 'missing', workflowVersion: 1 },
            },
          ],
          edges: [],
        },
        contract: { inputs: [], outputs: [], exposedParams: [] },
      },
      { workflowId: 'root', resolveSubworkflowPackage: () => null },
    )

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'subworkflow_missing',
        nodeId: 'call-missing',
        workflowId: 'missing',
      }),
    )
  })

  it('validates every pinned version when the same subworkflow is referenced twice', () => {
    const base = workflowPackage()
    const validChild = workflowPackage({
      graph: {
        nodes: [
          {
            id: 'child-output',
            kind: 'canvas_output',
            label: '输出',
            position: { x: 0, y: 0 },
            config: {},
          },
        ],
        edges: [],
      },
      contract: { inputs: [], outputs: [], exposedParams: [] },
    })
    const invalidChild = workflowPackage({
      graph: {
        nodes: [
          {
            id: 'missing-grandchild',
            kind: 'canvas_subworkflow',
            label: '缺失孙工作流',
            position: { x: 0, y: 0 },
            config: { workflowId: 'grandchild', workflowVersion: 1 },
          },
        ],
        edges: [],
      },
      contract: { inputs: [], outputs: [], exposedParams: [] },
    })
    const root = workflowPackage({
      graph: {
        nodes: [
          {
            id: 'child-v1',
            kind: 'canvas_subworkflow',
            label: '子工作流 v1',
            position: { x: 0, y: 0 },
            config: { workflowId: 'child', workflowVersion: 1 },
          },
          {
            id: 'child-v2',
            kind: 'canvas_subworkflow',
            label: '子工作流 v2',
            position: { x: 240, y: 0 },
            config: { workflowId: 'child', workflowVersion: 2 },
          },
        ],
        edges: [],
      },
      contract: { inputs: [], outputs: [], exposedParams: [] },
    })

    const result = compileCanvasWorkflowPackage(root, {
      workflowId: 'root',
      resolveSubworkflowPackage: (workflowId, version) => {
        if (workflowId === 'child' && version === 1) return validChild
        if (workflowId === 'child' && version === 2) return invalidChild
        return null
      },
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'subworkflow_missing', workflowId: 'grandchild' }),
    )
  })

  it('requires an immutable version for subworkflow references', () => {
    const base = workflowPackage()
    const result = compileCanvasWorkflowPackage(
      {
        ...base,
        graph: {
          nodes: [
            {
              id: 'call-child',
              kind: 'canvas_subworkflow',
              label: '子工作流',
              position: { x: 0, y: 0 },
              config: { workflowId: 'child' },
            },
          ],
          edges: [],
        },
        contract: { inputs: [], outputs: [], exposedParams: [] },
      },
      { workflowId: 'root', resolveSubworkflowPackage: () => base },
    )

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'subworkflow_version_missing', nodeId: 'call-child' }),
    )
  })
})
