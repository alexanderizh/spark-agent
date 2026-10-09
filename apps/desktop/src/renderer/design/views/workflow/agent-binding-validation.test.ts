import { describe, expect, it } from 'vitest'
import type { WorkflowGraph } from '@spark/protocol'
import { defaultLoopBodyGraph } from './loop-body-editor'
import { collectAgentBindingIssues } from './agent-binding-validation'

function agentNode(id: string, agentId?: string): WorkflowGraph['nodes'][number] {
  return {
    id,
    kind: 'agent',
    title: `执行-${id}`,
    x: 80,
    y: 120,
    config: { outputKey: `${id}_output`, ...(agentId != null ? { agentId } : {}) },
  }
}

function graphOf(nodes: WorkflowGraph['nodes']): WorkflowGraph {
  return { nodes, edges: [] }
}

const KNOWN_AGENTS = new Set(['agent-a', 'agent-b'])

describe('collectAgentBindingIssues', () => {
  it('agent 节点未配置 agentId 时产出 warning（不阻断保存）', () => {
    const issues = collectAgentBindingIssues(graphOf([agentNode('a1')]), KNOWN_AGENTS)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      level: 'warning',
      code: 'agent_unbound',
      nodeId: 'a1',
    })
    expect(issues[0]?.message).toContain('回退使用会话当前 Agent')
  })

  it('agentId 为空白字符串同样视为未配置', () => {
    const issues = collectAgentBindingIssues(graphOf([agentNode('a1', '   ')]), KNOWN_AGENTS)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.code).toBe('agent_unbound')
  })

  it('agentId 指向不存在的 Agent 时产出 error（阻断保存）', () => {
    const issues = collectAgentBindingIssues(graphOf([agentNode('a1', 'agent-gone')]), KNOWN_AGENTS)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      level: 'error',
      code: 'agent_not_found',
      nodeId: 'a1',
    })
    expect(issues[0]?.message).toContain('已不存在')
  })

  it('绑定的 Agent 存在时不产出任何问题', () => {
    const issues = collectAgentBindingIssues(graphOf([agentNode('a1', 'agent-a')]), KNOWN_AGENTS)
    expect(issues).toHaveLength(0)
  })

  it('非 agent 节点不参与校验', () => {
    const graph = graphOf([
      { id: 'in', kind: 'input', title: '输入', x: 0, y: 0, config: {} },
      {
        id: 'sub',
        kind: 'subagent',
        title: '子代理',
        x: 0,
        y: 0,
        config: {},
      },
    ])
    expect(collectAgentBindingIssues(graph, KNOWN_AGENTS)).toHaveLength(0)
  })

  it('递归覆盖循环节点循环体内的执行节点', () => {
    const body = defaultLoopBodyGraph()
    body.nodes.push(agentNode('inner-agent'))
    const graph = graphOf([
      {
        id: 'loop-1',
        kind: 'loop',
        title: '循环',
        x: 0,
        y: 0,
        config: { outputKey: 'loop_result', body },
      },
    ])
    const issues = collectAgentBindingIssues(graph, KNOWN_AGENTS)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.nodeId).toBe('inner-agent')
  })

  it('循环体格式无效时安全跳过，不抛错', () => {
    const graph = graphOf([
      {
        id: 'loop-1',
        kind: 'loop',
        title: '循环',
        x: 0,
        y: 0,
        config: {
          outputKey: 'loop_result',
          // 故意畸形：校验器须安全跳过非法循环体（isWorkflowGraph 守卫），不抛错。
          body: { nodes: 'bad' } as unknown as WorkflowGraph,
        },
      },
    ])
    expect(collectAgentBindingIssues(graph, KNOWN_AGENTS)).toHaveLength(0)
  })
})
