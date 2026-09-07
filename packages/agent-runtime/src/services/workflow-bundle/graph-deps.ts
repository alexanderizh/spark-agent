/**
 * 工作流图依赖提取与引用改写(含 loop.body 递归)
 */

import type { WorkflowGraph, WorkflowNodeConfig } from '@spark/protocol'

export interface GraphDependencies {
  skillIds: string[]
  mcpServerIds: string[]
  agentIds: string[]
  ruleIds: string[]
  toolIds: string[]
}

function mergeInto(target: GraphDependencies, config: WorkflowNodeConfig): void {
  for (const id of config.skillIds ?? [])
    if (!target.skillIds.includes(id)) target.skillIds.push(id)
  for (const id of config.mcpServerIds ?? [])
    if (!target.mcpServerIds.includes(id)) target.mcpServerIds.push(id)
  for (const id of config.ruleIds ?? []) if (!target.ruleIds.includes(id)) target.ruleIds.push(id)
  for (const id of config.toolIds ?? []) if (!target.toolIds.includes(id)) target.toolIds.push(id)
  if (
    typeof config.agentId === 'string' &&
    config.agentId.length > 0 &&
    !target.agentIds.includes(config.agentId)
  ) {
    target.agentIds.push(config.agentId)
  }
}

function emptyDeps(): GraphDependencies {
  return { skillIds: [], mcpServerIds: [], agentIds: [], ruleIds: [], toolIds: [] }
}

/** 深度收集一张图(含 loop.body 嵌套体)的全部外部依赖引用。 */
export function collectGraphDependencies(graph: WorkflowGraph): GraphDependencies {
  const deps = emptyDeps()
  const walk = (g: WorkflowGraph) => {
    for (const node of g.nodes ?? []) {
      const config = (node.config ?? {}) as WorkflowNodeConfig
      mergeInto(deps, config)
      if (config.body != null) walk(config.body)
    }
  }
  walk(graph)
  return deps
}

function rewriteConfig(config: WorkflowNodeConfig, mapping: RewriteMapping): WorkflowNodeConfig {
  const next: WorkflowNodeConfig = { ...config }
  if (Array.isArray(config.skillIds)) {
    next.skillIds = config.skillIds.map((id) => mapping.skillIdMap.get(id) ?? id)
  }
  if (Array.isArray(config.mcpServerIds)) {
    next.mcpServerIds = config.mcpServerIds.map((id) => mapping.mcpServerIdMap.get(id) ?? id)
  }
  if (config.body != null) {
    next.body = rewriteGraphReferences(config.body, mapping)
  }
  return next
}

export interface RewriteMapping {
  /** 原技能 ID → 新技能 ID(bundle:<bundleId>:<slug>) */
  skillIdMap: Map<string, string>
  /** 原 MCP 服务器 ID → 新 mcp_servers 行 ID */
  mcpServerIdMap: Map<string, string>
}

/** 返回改写后的图(深拷贝变化部分;不动原对象)。 */
export function rewriteGraphReferences(
  graph: WorkflowGraph,
  mapping: RewriteMapping,
): WorkflowGraph {
  return {
    ...graph,
    nodes: (graph.nodes ?? []).map((node) => ({
      ...node,
      config: rewriteConfig((node.config ?? {}) as WorkflowNodeConfig, mapping),
    })),
    edges: graph.edges ?? [],
  }
}
