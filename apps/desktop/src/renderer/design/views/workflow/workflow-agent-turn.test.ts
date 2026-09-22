import { describe, expect, it } from 'vitest'
import type { WorkflowGraph } from '@spark/protocol'
import {
  buildWorkflowGraphSummary,
  buildWorkflowTurnPrefix,
  circuitBrokenResponse,
  createValidateCircuit,
} from './workflow-agent-turn'

function makeGraph(
  nodeCount: number,
  withOutputKey = false,
  edges: Array<{ id: string; from: string; to: string }> = [],
): WorkflowGraph {
  return {
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `node-${index + 1}`,
      kind: 'agent',
      title: `节点 ${index + 1}`,
      config: withOutputKey ? { outputKey: `out${index + 1}` } : {},
    })),
    edges,
  } as unknown as WorkflowGraph
}

describe('buildWorkflowGraphSummary', () => {
  it('returns an empty-graph notice for a graph without nodes', () => {
    expect(buildWorkflowGraphSummary(makeGraph(0))).toContain('当前图为空')
  })

  it('embeds the full compact JSON when the graph fits the limit', () => {
    const summary = buildWorkflowGraphSummary(makeGraph(3))
    expect(summary).toContain('当前图完整 JSON（3 节点')
    expect(summary).toContain('"kind":"agent"')
    expect(summary).toContain('node-2')
  })

  it('keeps from/to edge links in the compact JSON summary', () => {
    // 回归护栏：摘要边字段必须是协议真实的 from/to（曾因写成 sourceNodeId/targetNodeId 丢失全部连线）
    const summary = buildWorkflowGraphSummary(
      makeGraph(2, false, [{ id: 'e-1', from: 'node-1', to: 'node-2' }]),
    )
    expect(summary).toContain('"from":"node-1"')
    expect(summary).toContain('"to":"node-2"')
    expect(summary).toContain('2 节点 / 1 连线')
  })

  it('degrades to a node listing above the 30-node limit and keeps outputKey hints', () => {
    const summary = buildWorkflowGraphSummary(makeGraph(32, true))
    expect(summary).toContain('仅列清单')
    expect(summary).toContain('- node-1 [agent] 节点 1 outputKey=out1')
    expect(summary).toContain('workflow_get_graph')
    expect(summary).not.toContain('"kind":"agent"')
  })
})

describe('buildWorkflowTurnPrefix', () => {
  it('includes binding metadata, summary and tool discipline', () => {
    const prefix = buildWorkflowTurnPrefix({
      workflowId: 'wf-1',
      name: '代码评审工作流',
      graph: makeGraph(2),
    })
    expect(prefix).toContain('[工作流绑定]')
    expect(prefix).toContain('workflowId: wf-1')
    expect(prefix).toContain('workflowName: 代码评审工作流')
    expect(prefix).toContain('workflow_get_graph')
    expect(prefix).toContain('graph_changed_since_read')
  })

  it('uses the draft marker and appends the circuit notice when tripped', () => {
    const prefix = buildWorkflowTurnPrefix(
      { workflowId: null, name: '草稿', graph: makeGraph(1) },
      { circuitBroken: true },
    )
    expect(prefix).toContain('（未保存草稿）')
    expect(prefix).toContain('[熔断激活]')
    expect(prefix).toContain('连续失败 3 次')
  })
})

describe('createValidateCircuit', () => {
  it('trips after the configured consecutive failures and resets on success or new turn', () => {
    const circuit = createValidateCircuit(3)
    circuit.record(false)
    circuit.record(false)
    expect(circuit.isTripped()).toBe(false)
    circuit.record(false)
    expect(circuit.isTripped()).toBe(true)

    // 新 turn 重置
    circuit.reset()
    expect(circuit.isTripped()).toBe(false)

    // 成功清零连续计数
    circuit.record(false)
    circuit.record(false)
    circuit.record(true)
    circuit.record(false)
    circuit.record(false)
    expect(circuit.isTripped()).toBe(false)
  })
})

describe('circuitBrokenResponse', () => {
  it('shapes a workflow:validate-compatible rejection with an actionable message', () => {
    const response = circuitBrokenResponse()
    expect(response.ok).toBe(false)
    expect(response.circuitBroken).toBe(true)
    expect(response.diagnostics[0]?.code).toBe('validate_circuit_broken')
    expect(response.diagnostics[0]?.message).toContain('停止重试')
  })
})
