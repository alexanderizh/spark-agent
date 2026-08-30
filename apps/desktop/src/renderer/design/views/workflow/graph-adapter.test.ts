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

  it('preserves a loop body orientation and conditional edge through the root round trip', () => {
    const graph: WorkflowGraph = {
      nodes: [
        {
          id: 'loop',
          kind: 'loop',
          title: 'Iterate',
          x: 80,
          y: 120,
          config: {
            outputKey: 'final',
            body: {
              orientation: 'vertical',
              nodes: [
                {
                  id: 'draft',
                  kind: 'agent',
                  title: 'Draft',
                  x: 80,
                  y: 120,
                  config: { outputKey: 'draft' },
                },
                {
                  id: 'judge',
                  kind: 'review',
                  title: 'Judge',
                  x: 80,
                  y: 320,
                  config: { outputKey: 'verdict' },
                },
              ],
              edges: [
                {
                  id: 'draft-judge',
                  from: 'draft',
                  to: 'judge',
                  condition: { op: 'exists', key: 'draft' },
                },
              ],
            },
          },
        },
      ],
      edges: [],
      orientation: 'vertical',
    }

    const rootFlow = graphToReactFlow(graph)
    const roundTripped = reactFlowToGraph(rootFlow.nodes, rootFlow.edges, 'vertical')
    const body = roundTripped.nodes[0]?.config.body
    if (body == null) throw new Error('loop body missing after round trip')

    expect(body.orientation).toBe('vertical')
    expect(body.edges[0]?.condition).toEqual({ op: 'exists', key: 'draft' })
    const bodyFlow = graphToReactFlow(body)
    expect(reactFlowToGraph(bodyFlow.nodes, bodyFlow.edges, 'vertical')).toEqual(body)
  })
})
