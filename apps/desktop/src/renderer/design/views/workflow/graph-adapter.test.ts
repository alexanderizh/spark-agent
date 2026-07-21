import { describe, expect, it } from 'vitest'
import type { WorkflowGraph } from '@spark/protocol'
import { graphToReactFlow, reactFlowToGraph } from './graph-adapter'

describe('workflow graph adapter', () => {
  it('round-trips conditional edge data through React Flow edges', () => {
    const graph: WorkflowGraph = {
      nodes: [
        {
          id: 'route',
          kind: 'plan',
          title: 'Route',
          x: 80,
          y: 120,
          config: { outputKey: 'route' },
        },
        {
          id: 'deep',
          kind: 'agent',
          title: 'Deep path',
          x: 340,
          y: 120,
          config: { outputKey: 'result' },
        },
      ],
      edges: [
        {
          id: 'route-deep',
          from: 'route',
          to: 'deep',
          condition: { op: 'equals', key: 'route', value: 'deep' },
        },
      ],
      orientation: 'vertical',
    }

    const flow = graphToReactFlow(graph)

    expect(flow.edges[0]?.data).toEqual({
      condition: { op: 'equals', key: 'route', value: 'deep' },
    })
    expect(flow.edges[0]?.label).toBe('route = "deep"')
    expect(flow.edges[0]?.className).toBe('wf-edge-conditional')

    expect(reactFlowToGraph(flow.nodes, flow.edges, 'vertical')).toEqual(graph)
  })
})
