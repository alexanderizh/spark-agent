import type { WorkflowGraph, WorkflowNode } from '@spark/protocol'
import { isWorkflowGraph } from './loop-body-editor'

export type AgentBindingIssueLevel = 'error' | 'warning'

export type AgentBindingIssueCode = 'agent_unbound' | 'agent_not_found'

export type AgentBindingIssue = {
  level: AgentBindingIssueLevel
  code: AgentBindingIssueCode
  nodeId: string
  nodeTitle: string
  message: string
}

function isBlankAgentId(agentId: unknown): boolean {
  return typeof agentId !== 'string' || agentId.trim().length === 0
}

function collectGraphAgentBindingIssues(
  graph: WorkflowGraph,
  knownAgentIds: ReadonlySet<string>,
  issues: AgentBindingIssue[],
): void {
  for (const node of graph.nodes) {
    collectNodeAgentBindingIssues(node, knownAgentIds, issues)
  }
}

function collectNodeAgentBindingIssues(
  node: WorkflowNode,
  knownAgentIds: ReadonlySet<string>,
  issues: AgentBindingIssue[],
): void {
  // 仅 agent 节点适用「回退会话当前 Agent」语义；subagent 留空是「生成临时子代理」的正常用法。
  if (node.kind !== 'agent') {
    // 循环节点继续下钻循环体：体内的执行节点同样参与校验（与 validateWorkflowLoopBodies 口径一致）。
    if (node.kind === 'loop' && isWorkflowGraph(node.config.body)) {
      collectGraphAgentBindingIssues(node.config.body, knownAgentIds, issues)
    }
    return
  }
  const title = node.title || node.id
  if (isBlankAgentId(node.config.agentId)) {
    issues.push({
      level: 'warning',
      code: 'agent_unbound',
      nodeId: node.id,
      nodeTitle: title,
      message: `执行节点「${title}」未配置执行者，运行时将回退使用会话当前 Agent，建议显式指定。`,
    })
    return
  }
  const agentId = String(node.config.agentId).trim()
  if (!knownAgentIds.has(agentId)) {
    issues.push({
      level: 'error',
      code: 'agent_not_found',
      nodeId: node.id,
      nodeTitle: title,
      message: `执行节点「${title}」引用的 Agent 已不存在，请重新选择执行者。`,
    })
  }
}

/**
 * 执行节点（kind='agent'）执行者绑定校验：
 * - 未绑定 → warning（不阻断保存）：运行时已有 sessionAgentId 回退链兜底；
 * - 绑定的 Agent 已不在当前列表 → error（阻断保存）：保存后运行时必然派发失败。
 * 递归覆盖 loop 节点循环体内的执行节点，口径与 validateWorkflowLoopBodies 一致。
 */
export function collectAgentBindingIssues(
  graph: WorkflowGraph,
  knownAgentIds: ReadonlySet<string>,
): AgentBindingIssue[] {
  const issues: AgentBindingIssue[] = []
  collectGraphAgentBindingIssues(graph, knownAgentIds, issues)
  return issues
}
