import {
  AgentRepository,
  CustomToolRepository,
  McpServerRepository,
  SkillRepository,
  SessionRepository,
  ToolPackageRepository,
  WorkflowBundleRepository,
  WorkflowRepository,
  type SparkDatabase,
} from '@spark/storage'
import {
  WORKFLOW_RESTRICTABLE_TOOL_NAMES,
  type WorkflowNodeKind,
  type WorkflowPreflightIssue,
} from '@spark/protocol'
import {
  detectWorkflowConditionReferenceErrors,
  detectWorkflowGraphCycles,
  normalizeWorkflowGraph,
  type NormalizedWorkflowGraph,
} from '../workflow-executor.js'
import { readSessionTeamConfig } from '../session/session-pure-utils.js'

const SUPPORTED_NODE_KINDS = new Set<WorkflowNodeKind>([
  'input',
  'plan',
  'route',
  'agent',
  'subagent',
  'skill',
  'tool',
  'mcp',
  'approval',
  'verify',
  'review',
  'artifact',
  'loop',
])

export interface WorkflowPreflightResult {
  ok: boolean
  issues: WorkflowPreflightIssue[]
  warnings: WorkflowPreflightIssue[]
}

/** Static readiness validation shared by binding writes and atomic session creation. */
export class WorkflowPreflightService {
  constructor(private readonly db: SparkDatabase) {}

  inspect(
    input:
      | { mode: 'disabled'; sessionId?: string; hostAgentId?: string }
      | { mode: 'inherit'; sessionId?: string; hostAgentId?: string }
      | { mode: 'override'; workflowId: string; sessionId?: string; hostAgentId?: string },
  ): WorkflowPreflightResult {
    if (input.mode === 'disabled') return { ok: true, issues: [], warnings: [] }
    if (input.mode === 'override') return this.inspectOverride(input.workflowId)
    return this.inspectInherited(input)
  }

  private inspectInherited(input: {
    sessionId?: string
    hostAgentId?: string
  }): WorkflowPreflightResult {
    let hostAgentId = input.hostAgentId
    if (hostAgentId == null && input.sessionId != null) {
      const session = new SessionRepository(this.db).get(input.sessionId)
      if (session == null) return result([{ code: 'missing_agent' }], [])
      const team = readSessionTeamConfig(session)
      hostAgentId = team?.enabled === true ? team.hostAgentId : session.agent_id
    }
    if (hostAgentId == null) return { ok: true, issues: [], warnings: [] }
    const hostAgent = new AgentRepository(this.db).get(hostAgentId)
    if (hostAgent == null) {
      return result([{ code: 'missing_agent', dependencyId: hostAgentId }], [])
    }
    return hostAgent.workflowId == null
      ? { ok: true, issues: [], warnings: [] }
      : this.inspectOverride(hostAgent.workflowId)
  }

  inspectOverride(workflowId: string): WorkflowPreflightResult {
    const issues: WorkflowPreflightIssue[] = []
    const warnings: WorkflowPreflightIssue[] = []
    const workflow = new WorkflowRepository(this.db).get(workflowId)
    if (workflow == null) return result([{ code: 'workflow_not_found' }], warnings)
    if (!workflow.enabled) issues.push({ code: 'workflow_disabled' })
    if (workflow.status !== 'active') {
      issues.push({ code: 'workflow_not_active', params: { status: workflow.status } })
    }

    inspectRawGraph(workflow.graph, issues)
    const graph = normalizeWorkflowGraph(workflow.graph)
    inspectNormalizedGraph(graph, issues)
    this.inspectDependencies(graph, issues)

    if (
      workflow.bundleId != null &&
      new WorkflowBundleRepository(this.db).get(workflow.bundleId) == null
    ) {
      warnings.push({
        code: 'bundle_dependency_unresolved',
        dependencyId: workflow.bundleId,
      })
    }
    return result(issues, warnings)
  }

  private inspectDependencies(
    graph: NormalizedWorkflowGraph,
    issues: WorkflowPreflightIssue[],
  ): void {
    const agents = new AgentRepository(this.db)
    const skills = new SkillRepository(this.db)
    const mcpServers = new McpServerRepository(this.db)
    const customTools = new CustomToolRepository(this.db)
    const toolPackages = new ToolPackageRepository(this.db)

    for (const node of collectNodes(graph)) {
      const agentId = readConfigId(node.config.agentId)
      if (agentId != null) {
        const agent = agents.get(agentId)
        if (agent == null)
          issues.push({ code: 'missing_agent', nodeId: node.id, dependencyId: agentId })
        else if (!agent.enabled) {
          issues.push({ code: 'disabled_agent', nodeId: node.id, dependencyId: agentId })
        }
      }
      for (const skillId of readConfigIds(node.config.skillIds)) {
        if (skills.get(skillId)?.enabled !== 1) {
          issues.push({
            code: 'missing_required_skill',
            nodeId: node.id,
            dependencyId: skillId,
          })
        }
      }
      for (const serverId of readConfigIds(node.config.mcpServerIds)) {
        if (mcpServers.get(serverId)?.enabled !== 1) {
          issues.push({
            code: 'missing_required_mcp',
            nodeId: node.id,
            dependencyId: serverId,
          })
        }
      }
      for (const toolId of readConfigIds(node.config.toolIds)) {
        if (!WORKFLOW_RESTRICTABLE_TOOL_NAMES.includes(toolId)) {
          issues.push({ code: 'missing_required_tool', nodeId: node.id, dependencyId: toolId })
        }
      }

      const source = node.config.toolSource
      const toolName = readConfigId(node.config.toolName)
      if (
        source === 'builtin' &&
        (toolName == null || !WORKFLOW_RESTRICTABLE_TOOL_NAMES.includes(toolName))
      ) {
        issues.push({
          code: 'missing_required_tool',
          nodeId: node.id,
          ...(toolName != null ? { dependencyId: toolName } : {}),
        })
      }
      if (source === 'mcp') {
        const serverId = readConfigId(node.config.toolServerId)
        if (serverId == null || mcpServers.get(serverId)?.enabled !== 1) {
          issues.push({
            code: 'missing_required_mcp',
            nodeId: node.id,
            ...(serverId != null ? { dependencyId: serverId } : {}),
          })
        }
        if (toolName == null) issues.push({ code: 'missing_required_tool', nodeId: node.id })
      }
      if (source === 'platform') {
        if (toolName == null || !isEnabledPlatformTool(toolName, customTools, toolPackages)) {
          issues.push({
            code: 'missing_required_tool',
            nodeId: node.id,
            ...(toolName != null ? { dependencyId: toolName } : {}),
          })
        }
      }
    }
  }
}

function inspectRawGraph(graph: Record<string, unknown>, issues: WorkflowPreflightIssue[]): void {
  const visit = (candidate: unknown, scope: string, outerIds: Set<string>): void => {
    if (candidate == null || typeof candidate !== 'object') {
      issues.push({ code: 'invalid_loop_body', params: { scope } })
      return
    }
    const raw = candidate as Record<string, unknown>
    if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
      issues.push({ code: 'invalid_loop_body', params: { scope } })
      return
    }
    const ids = new Set<string>()
    for (const candidateNode of raw.nodes) {
      if (candidateNode == null || typeof candidateNode !== 'object') continue
      const node = candidateNode as Record<string, unknown>
      const nodeId = readConfigId(node.id)
      const kind = typeof node.kind === 'string' ? node.kind : ''
      if (!SUPPORTED_NODE_KINDS.has(kind as WorkflowNodeKind)) {
        issues.push({
          code: 'unsupported_node_kind',
          ...(nodeId != null ? { nodeId } : {}),
          params: { kind: kind || 'unknown', scope },
        })
      }
      if (nodeId != null) {
        if (ids.has(nodeId) || outerIds.has(nodeId)) {
          issues.push({
            code: 'invalid_loop_body',
            nodeId,
            params: { scope, reason: 'duplicate_node_id' },
          })
        }
        ids.add(nodeId)
      }
      if (kind !== 'loop') continue
      const config =
        node.config != null && typeof node.config === 'object'
          ? (node.config as Record<string, unknown>)
          : {}
      const body = config.body
      if (scope !== '主图') {
        issues.push({
          code: 'invalid_loop_body',
          ...(nodeId != null ? { nodeId } : {}),
          params: { scope, reason: 'nested_loop' },
        })
      }
      visit(
        body,
        `${scope} › ${typeof node.title === 'string' ? node.title : (nodeId ?? 'loop')} 循环体`,
        new Set([...outerIds, ...ids]),
      )
    }
  }
  visit(graph, '主图', new Set())
}

function inspectNormalizedGraph(
  graph: NormalizedWorkflowGraph,
  issues: WorkflowPreflightIssue[],
): void {
  for (const report of detectWorkflowGraphCycles(graph)) {
    issues.push({
      code: 'graph_cycle',
      params: {
        scope: report.scope,
        nodes: report.cycleNodes.map((node) => node.id).join(','),
      },
    })
  }
  for (const report of detectWorkflowConditionReferenceErrors(graph)) {
    issues.push({
      code: 'invalid_condition_reference',
      params: { scope: report.scope, owner: report.owner, key: report.key },
    })
  }
}

function collectNodes(graph: NormalizedWorkflowGraph): NormalizedWorkflowGraph['nodes'] {
  const nodes = [...graph.nodes]
  for (const node of graph.nodes) {
    if (node.kind !== 'loop' || node.config.body == null || typeof node.config.body !== 'object')
      continue
    const body = normalizeWorkflowGraph(node.config.body as Record<string, unknown>)
    nodes.push(...collectNodes(body))
  }
  return nodes
}

function isEnabledPlatformTool(
  id: string,
  customTools: CustomToolRepository,
  toolPackages: ToolPackageRepository,
): boolean {
  if (!id.includes('/')) {
    const tool = customTools.get(id)
    return tool?.enabled === true && tool.publishedVersion != null
  }
  const separator = id.indexOf('/')
  const packageId = id.slice(0, separator)
  const toolName = id.slice(separator + 1)
  const pkg = toolPackages.get(packageId)
  return (
    pkg?.state === 'enabled' &&
    pkg.enabled_version != null &&
    toolPackages
      .listTools(packageId, pkg.enabled_version)
      .some((tool) => tool.tool_name === toolName && tool.enabled === 1)
  )
}

function readConfigId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readConfigIds(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : []
}

function result(
  issues: WorkflowPreflightIssue[],
  warnings: WorkflowPreflightIssue[],
): WorkflowPreflightResult {
  return { ok: issues.length === 0, issues: dedupe(issues), warnings: dedupe(warnings) }
}

function dedupe(items: WorkflowPreflightIssue[]): WorkflowPreflightIssue[] {
  return [...new Map(items.map((item) => [JSON.stringify(item), item])).values()]
}
