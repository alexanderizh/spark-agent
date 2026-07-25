/**
 * Session 工作流辅助纯函数（从 session.service.ts 拆分，D-13）。
 *
 * 包含（按主题分组）：
 *
 * ## Worker 构造与节点覆盖
 * - createWorkflowSubagentMember: 临时 subagent member（继承 hostAgent 配置）
 * - applyWorkflowNodeOverrides: 把节点配置覆盖到 member
 * - workflowNodeToolIdsMeta: 节点配置的 toolIds → metadata
 * - memberDisallowedToolsFromConfig: member.metadata.toolIds → disallowedTools
 * - nullableStringConfig / stringConfig / stringArrayConfig: 配置字段安全解析
 *
 * ## 验证节点
 * - runWorkflowVerifyNode: 跑配置的 verifyCommands，捕 5xx/超时错误
 * - formatWorkflowVerifyCommandOutput: 格式化 stdout/stderr 输出
 * - getDefaultWorkflowAtomicContent: 节点无 verify 时使用的默认内容
 *
 * ## Input / Route 节点结构化解析
 * - trimJsonFence: 剥离 ```json / ``` fence
 * - validateWorkflowInputStructuredContent: input 节点 JSON 校验 + 回落透传（导出）
 * - normalizeWorkflowRouteOptions: route 节点 options 标准化（导出）
 * - extractWorkflowRouteDecision: 从 rawContent 提取 route 决策
 * - validateWorkflowRouteDecisionContent: route 决策校验（导出）
 *
 * ## 审批节点答案解析
 * - findWorkflowApprovalAnswerImpl: 在 answers.answers（中按 question/数组下标定位）
 * - extractWorkflowApprovalTextImpl: 从单条答案里取出可读文本
 * - isWorkflowApprovalApprovedImpl: 判断审批是否被"明确批准"
 * - extractWorkflowApprovalCommentImpl: 提取审批修改意见
 *
 * ## 原子节点真实执行
 * - WORKFLOW_LLM_ATOMIC_KINDS / WORKFLOW_READONLY_DISALLOWED_TOOLS / WORKFLOW_READONLY_ALLOWED_TOOL_IDS
 * - workflowAtomicMemberId: 临时 worker id 生成
 * - shouldRunWorkflowAtomicNodeAsAgent: 节点是否走真实执行
 * - createWorkflowAtomicMember: 构造临时原子 worker
 * - buildWorkflowAtomicInstruction: 真实执行时给临时 worker 的指令
 * - buildWorkflowRouteDecisionInstruction: route 节点专用指令
 * - buildWorkflowInputStructuredInstruction: input 节点专用指令
 * - resolveWorkflowArtifactExportPath: artifact 节点导出路径解析（防路径穿越）
 *
 * 依赖：workflow-executor.js (NormalizedWorkflowNode) + storage (AgentItem, WorkflowItem) +
 *      protocol (AgentEvent, UserQuestionPrompt, WorkflowNodeKind, WORKFLOW_RESTRICTABLE_TOOL_NAMES)
 *
 * session.service.ts 顶部 re-export 9 个外部 helper，保持向后兼容。
 */

import path from 'node:path'
import type { UserQuestionPrompt, WorkflowNodeKind } from '@spark/protocol'
import { WORKFLOW_RESTRICTABLE_TOOL_NAMES } from '@spark/protocol'
import type { AgentItem, WorkflowItem } from '@spark/storage'
import type { NormalizedWorkflowGraph, NormalizedWorkflowNode } from './workflow-executor.js'
import { getWorkflowNodeWorkerId } from './workflow-executor.js'
import { buildWorkflowSystemPrompt } from './workflow-system-prompt.js'
import type { WorkflowExecutionMode } from './workflow-system-prompt.js'

// ─── Worker 构造与节点覆盖 ───────────────────────────────────────────────────

export function buildManagedAgentSystemPrompt(
  agent: AgentItem,
  workflow: WorkflowItem | null,
  workflowExecutionMode: WorkflowExecutionMode = 'guided',
): string {
  const sections: string[] = [
    '[Managed Agent]',
    `Agent: ${agent.name} (${agent.id})`,
    agent.description.trim() ? `Description: ${agent.description.trim()}` : '',
    agent.prompt.trim() ? `[Agent Instructions]\n${agent.prompt.trim()}` : '',
  ].filter((section) => section.trim().length > 0)

  const workflowPrompt =
    workflow != null ? buildWorkflowSystemPrompt(workflow, workflowExecutionMode) : ''
  if (workflowPrompt.trim().length > 0) sections.push(workflowPrompt)
  return sections.join('\n\n')
}

/**
 * 判定一个 workflow 是否有真正可派发执行的节点——只有命中 true 时，宿主才会被
 * 归类为「编排宿主」（注入 workflow_run 工具面 + [Orchestration Mode] 引导提示词；
 * 不再剥离任何工具，见 buildOrchestrationModeSystemPrompt）。
 * kind:"agent" 节点若没有绑定 config.agentId，或绑定到不可用 worker，语义上是继承
 * fallbackAgentId 指向的宿主 Agent；没有 fallback 时才保持旧的 guided 判定。
 * 单独导出以便直接用真实 graph 数据做回归测试。
 */
export function hasWorkflowExecutableNodes(
  graph: NormalizedWorkflowGraph,
  enabledWorkflowWorkerIds?: ReadonlySet<string>,
  fallbackAgentId?: string,
): boolean {
  const fallback = typeof fallbackAgentId === 'string' ? fallbackAgentId.trim() : ''
  return graph.nodes.some((node) => {
    if (node.kind !== 'agent' && node.kind !== 'subagent') return true
    const workerId = getWorkflowNodeWorkerId(node)
    if (workerId == null || workerId.length === 0) return fallback.length > 0
    if (node.kind === 'subagent') return true
    if (enabledWorkflowWorkerIds == null) return true
    return enabledWorkflowWorkerIds.has(workerId) || fallback.length > 0
  })
}

export function createWorkflowSubagentMember(
  node: NormalizedWorkflowNode,
  hostAgent: AgentItem,
  workerId: string,
): AgentItem {
  const now = new Date(0).toISOString()
  const prompt =
    typeof node.config.prompt === 'string' && node.config.prompt.trim().length > 0
      ? node.config.prompt.trim()
      : node.title
  const role =
    typeof node.config.role === 'string' && node.config.role.trim().length > 0
      ? node.config.role.trim()
      : ''
  return {
    id: workerId,
    name: node.title,
    description: role,
    builtIn: false,
    enabled: true,
    isDefault: false,
    providerProfileId:
      typeof node.config.providerProfileId === 'string'
        ? node.config.providerProfileId
        : (hostAgent.providerProfileId ?? null),
    modelId:
      typeof node.config.modelId === 'string' ? node.config.modelId : (hostAgent.modelId ?? null),
    agentAdapter:
      typeof node.config.agentAdapter === 'string'
        ? node.config.agentAdapter
        : hostAgent.agentAdapter,
    // 节点级 permissionMode 覆盖已下线：executeMemberTurn 里成员权限统一走 claude-auto
    // （避免并行 dispatch 时多个审批框互相打断），节点上配这个字段从来不会真正生效，
    // 干脆不再提供这个"看起来能配但没用"的入口。
    permissionMode: hostAgent.permissionMode,
    reasoningEffort:
      typeof node.config.reasoningEffort === 'string'
        ? node.config.reasoningEffort
        : hostAgent.reasoningEffort,
    prompt,
    ruleIds: stringArrayConfig(node.config.ruleIds),
    skillIds: stringArrayConfig(node.config.skillIds),
    disabledSkillIds: stringArrayConfig(node.config.disabledSkillIds),
    mcpServerIds: stringArrayConfig(node.config.mcpServerIds),
    hookConfig: {},
    workflowId: null,
    metadata: {
      workflowNodeId: node.id,
      temporaryWorkflowSubagent: true,
      ...workflowNodeToolIdsMeta(node),
    },
    createdAt: now,
    updatedAt: now,
  }
}

export function applyWorkflowNodeOverrides(member: AgentItem, node: NormalizedWorkflowNode): AgentItem {
  const prompt =
    typeof node.config.prompt === 'string' && node.config.prompt.trim().length > 0
      ? node.config.prompt.trim()
      : member.prompt
  const description =
    typeof node.config.role === 'string' && node.config.role.trim().length > 0
      ? node.config.role.trim()
      : member.description
  return {
    ...member,
    description,
    providerProfileId: nullableStringConfig(
      node.config.providerProfileId,
      member.providerProfileId,
    ),
    modelId: nullableStringConfig(node.config.modelId, member.modelId),
    agentAdapter: stringConfig(node.config.agentAdapter, member.agentAdapter),
    reasoningEffort: stringConfig(node.config.reasoningEffort, member.reasoningEffort),
    prompt,
    ruleIds: Array.isArray(node.config.ruleIds)
      ? stringArrayConfig(node.config.ruleIds)
      : member.ruleIds,
    skillIds: Array.isArray(node.config.skillIds)
      ? stringArrayConfig(node.config.skillIds)
      : member.skillIds,
    disabledSkillIds: Array.isArray(node.config.disabledSkillIds)
      ? stringArrayConfig(node.config.disabledSkillIds)
      : member.disabledSkillIds,
    mcpServerIds: Array.isArray(node.config.mcpServerIds)
      ? stringArrayConfig(node.config.mcpServerIds)
      : member.mcpServerIds,
    metadata: {
      ...member.metadata,
      workflowNodeId: node.id,
      workflowNodeOverrides: true,
      ...workflowNodeToolIdsMeta(node),
    },
  }
}

/**
 * 只在节点显式配置了 toolIds 时才写入 metadata——省略时代表"不限制"，
 * 与"用户显式选了空集合"（理论上不该出现，TagPicker 不允许提交空选择又不同于未配置）区分开，
 * 避免 executeMemberTurn 把"未配置"误判成"限制为空工具集"。
 */
export function workflowNodeToolIdsMeta(node: NormalizedWorkflowNode): { toolIds?: string[] } {
  const toolIds = stringArrayConfig(node.config.toolIds)
  return toolIds.length > 0 ? { toolIds } : {}
}

/** member.metadata.toolIds（工作流「工具」选择器）→ 该 member 这次 dispatch 要禁用的工具列表。未配置时不额外限制。 */
export function memberDisallowedToolsFromConfig(member: AgentItem): string[] {
  const toolIds = stringArrayConfig(member.metadata?.toolIds)
  if (toolIds.length === 0) return []
  const allowed = new Set(toolIds)
  return WORKFLOW_RESTRICTABLE_TOOL_NAMES.filter((name) => !allowed.has(name))
}

export function nullableStringConfig(value: unknown, fallback: string | null | undefined): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return fallback ?? null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : (fallback ?? null)
}

export function stringConfig(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function stringArrayConfig(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (typeof item !== 'string') return []
    const trimmed = item.trim()
    return trimmed.length > 0 ? [trimmed] : []
  })
}

// ─── 验证节点 ───────────────────────────────────────────────────────────────

export async function runWorkflowVerifyNode(
  request: {
    nodeId: string
    title: string
    objective: string
    config: Record<string, unknown>
  },
  workspaceRootPath: string,
): Promise<
  | { state?: 'completed'; content: string }
  | { state: 'failed'; content: string; error: { code: string; message: string } }
> {
  const commands = stringArrayConfig(request.config.verifyCommands)
  if (commands.length === 0) {
    return { content: getDefaultWorkflowAtomicContent(request) }
  }
  const { exec } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execAsync = promisify(exec)
  const outputs: string[] = []
  for (const command of commands) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceRootPath,
        timeout: 600_000,
        // 1MB 对大型 monorepo 的 test/lint 输出太小，超限时 exec 直接抛错，把"命令其实跑成功
        // 只是输出太长"误报成 verify 失败。放宽到 20MB，给复杂项目留够余量。
        maxBuffer: 20 * 1024 * 1024,
      })
      outputs.push(formatWorkflowVerifyCommandOutput(command, stdout, stderr))
    } catch (error) {
      const stdout =
        typeof (error as { stdout?: unknown }).stdout === 'string'
          ? (error as { stdout: string }).stdout
          : ''
      const stderr =
        typeof (error as { stderr?: unknown }).stderr === 'string'
          ? (error as { stderr: string }).stderr
          : ''
      const message = error instanceof Error ? error.message : String(error)
      const content = formatWorkflowVerifyCommandOutput(command, stdout, stderr)
      return {
        state: 'failed',
        content,
        error: {
          code: 'verify_failed',
          message,
        },
      }
    }
  }
  return { content: outputs.join('\n\n') }
}

export function formatWorkflowVerifyCommandOutput(
  command: string,
  stdout: string,
  stderr: string,
): string {
  return [
    `$ ${command}`,
    stdout.trim().length > 0 ? stdout.trim() : '',
    stderr.trim().length > 0 ? stderr.trim() : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function getDefaultWorkflowAtomicContent(request: {
  kind?: WorkflowNodeKind
  title: string
  objective: string
  config: Record<string, unknown>
}): string {
  if (request.kind === 'route') {
    const rawValue = request.config.value
    const configuredValue =
      typeof rawValue === 'string'
        ? rawValue.trim()
        : typeof rawValue === 'number' || typeof rawValue === 'boolean'
          ? String(rawValue)
          : ''
    const routeOptions = normalizeWorkflowRouteOptions(request.config)
    if (
      configuredValue.length > 0 &&
      (routeOptions.length === 0 || routeOptions.some((option) => option.value === configuredValue))
    ) {
      return configuredValue
    }
    const [firstRoute] = routeOptions
    if (firstRoute != null) return firstRoute.value
  }
  const value = request.config.value
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value != null) return JSON.stringify(value)
  const prompt = typeof request.config.prompt === 'string' ? request.config.prompt.trim() : ''
  if (prompt.length > 0) return prompt
  if (request.objective.trim().length > 0) return request.objective.trim()
  return request.title
}

// ─── Input / Route 节点结构化解析 ────────────────────────────────────────────

/**
 * 剥离 LLM 输出常见的 ```json / ``` 代码块围栏（仅当整段被 fence 包裹时），
 * 用于 input 节点结构化 JSON 校验前的预处理。非围栏包裹的原样返回。
 */
export function trimJsonFence(text: string): string {
  const match = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```\s*$/.exec(text)
  if (match == null) return text
  return match[1] ?? text
}

/**
 * 校验 input 节点经 LLM 派发后的输出是否为合法 JSON。
 * - 合法（含 ```json fence 包裹）：返回原内容（保留 fence 不破坏 LLM 原意），ok:true。
 * - 非法：回落透传 fallback + 追加 `[input 结构化解析失败，已回落透传]` 提示，ok:false。
 *
 * 单独导出以便单测直接覆盖成功/失败两条路径（executeAtomicNode 回调里调用它）。
 */
export function validateWorkflowInputStructuredContent(
  rawContent: string,
  fallback: string,
): { ok: true; content: string } | { ok: false; content: string } {
  const stripped = trimJsonFence(rawContent.trim())
  try {
    JSON.parse(stripped)
    return { ok: true, content: rawContent }
  } catch {
    return { ok: false, content: `${fallback}\n\n[input 结构化解析失败，已回落透传]` }
  }
}

export function normalizeWorkflowRouteOptions(
  config: Record<string, unknown>,
): Array<{ value: string; label?: string; description?: string }> {
  const raw = Array.isArray(config.routeOptions) ? config.routeOptions : []
  const seen = new Set<string>()
  return raw.flatMap((item) => {
    if (item == null || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const value = typeof record.value === 'string' ? record.value.trim() : ''
    if (value.length === 0 || seen.has(value)) return []
    seen.add(value)
    const label = typeof record.label === 'string' ? record.label.trim() : ''
    const description = typeof record.description === 'string' ? record.description.trim() : ''
    return [
      {
        value,
        ...(label.length > 0 ? { label } : {}),
        ...(description.length > 0 ? { description } : {}),
      },
    ]
  })
}

export function extractWorkflowRouteDecision(rawContent: string): string {
  const stripped = trimJsonFence(rawContent.trim()).trim()
  if (stripped.length === 0) return ''
  try {
    const parsed = JSON.parse(stripped) as unknown
    if (typeof parsed === 'string') return parsed.trim()
    if (parsed != null && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      for (const candidate of [record.route, record.decision, record.value]) {
        if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
      }
    }
  } catch {
    // Plain-text route values are the preferred output; JSON is only accepted for resilience.
  }
  return stripped.split(/\r?\n/, 1)[0]?.trim().replace(/^["']|["']$/g, '') ?? ''
}

export function validateWorkflowRouteDecisionContent(
  rawContent: string,
  config: Record<string, unknown>,
):
  | { ok: true; content: string; decision: string }
  | { ok: false; content: string; decision: string; message: string } {
  const decision = extractWorkflowRouteDecision(rawContent)
  if (decision.length === 0) {
    return {
      ok: false,
      content: rawContent,
      decision,
      message: '路由节点没有输出分支值。',
    }
  }
  const options = normalizeWorkflowRouteOptions(config)
  if (options.length === 0) {
    return { ok: true, content: decision, decision }
  }
  if (options.some((option) => option.value === decision)) {
    return { ok: true, content: decision, decision }
  }
  return {
    ok: false,
    content: rawContent,
    decision,
    message: `路由节点输出 "${decision}" 不在允许分支值中：${options.map((option) => option.value).join(', ')}`,
  }
}

// ─── 审批节点答案解析 ───────────────────────────────────────────────────────

/* 在 answers.answers（对象数组或映射）里按 question 引用 + 数组下标定位原始答案条目。 */
export function findWorkflowApprovalAnswerImpl(
  rawAnswers: unknown,
  question: UserQuestionPrompt,
  index = 0,
): unknown {
  if (Array.isArray(rawAnswers)) {
    return rawAnswers.find((entry, rawIndex) => {
      if (typeof entry !== 'object' || entry == null) return rawIndex === index
      const obj = entry as Record<string, unknown>
      return (
        obj.id === question.id ||
        obj.question === question.question ||
        obj.index === index ||
        rawIndex === index
      )
    })
  }
  if (typeof rawAnswers === 'object' && rawAnswers != null) {
    const map = rawAnswers as Record<string, unknown>
    return (
      map[question.question] ??
      (question.id != null ? map[question.id] : undefined) ??
      map[String(index)]
    )
  }
  return undefined
}

/** 从单条答案里取出可读文本（候选：answer/text/optionLabel/optionValue/value）。 */
export function extractWorkflowApprovalTextImpl(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (typeof raw !== 'object' || raw == null) return ''
  const obj = raw as Record<string, unknown>
  for (const candidate of [obj.answer, obj.text, obj.optionLabel, obj.optionValue, obj.value]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
  }
  return ''
}

/** 判断审批 decision 问题是否被「明确批准」（cancelled/declined/skipped/无明确 approve 视为未批准）。 */
export function isWorkflowApprovalApprovedImpl(
  answers: Record<string, unknown>,
  question: UserQuestionPrompt,
  index = 0,
): boolean {
  if (answers.cancelled === true || answers.declined === true) return false
  const raw = findWorkflowApprovalAnswerImpl(answers.answers, question, index)
  if (typeof raw === 'object' && raw != null) {
    const obj = raw as Record<string, unknown>
    if (obj.skipped === true || obj.declined === true) return false
  }
  const text = extractWorkflowApprovalTextImpl(raw).trim().toLowerCase()
  if (text.length === 0) return false
  return text.includes('批准') || text.includes('approve')
}

/** 从 answers 提取审批修改意见（comment 文本）；空串或 skipped/declined 一律视为无意见。 */
export function extractWorkflowApprovalCommentImpl(
  answers: Record<string, unknown>,
  question: UserQuestionPrompt,
  index: number,
): string {
  const raw = findWorkflowApprovalAnswerImpl(answers.answers, question, index)
  if (typeof raw === 'object' && raw != null) {
    const obj = raw as Record<string, unknown>
    if (obj.skipped === true || obj.declined === true) return ''
  }
  return extractWorkflowApprovalTextImpl(raw).trim()
}

// ─── 原子节点真实执行 ───────────────────────────────────────────────────────

/**
 * 允许经临时 worker 真实派发执行的原子节点类型。
 * verify（自跑命令）、approval（暂停问询）有各自的专用路径，不在此列；
 * input 走 LLM 结构化解析（与 plan/review 同机制：纯 LLM，不挂外部工具）。
 */
export const WORKFLOW_LLM_ATOMIC_KINDS = new Set<WorkflowNodeKind>([
  'input',
  'route',
  'skill',
  'tool',
  'mcp',
  'plan',
  'review',
  'artifact',
])

/**
 * plan / review 节点限制为「只读」工具集：禁掉写与执行类工具（Write/Edit/MultiEdit/NotebookEdit/Bash），
 * 只保留探索（Read/Grep/Glob/Web*）与协作类，产出计划/复核文本而不去改动工作区。
 * 用禁用名单而不是白名单，是为了与 memberDisallowedToolsFromConfig 的 disallowedTools 语义一致
 * （allowedTools 在 SDK 里只是免审批名单，挡不住其它工具）。
 */
export const WORKFLOW_READONLY_DISALLOWED_TOOLS: string[] = [
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
]

/** 供 plan/review 节点用的「只读」toolIds 白名单（= 全量可限制工具 - 写/执行类）。 */
export const WORKFLOW_READONLY_ALLOWED_TOOL_IDS: string[] = WORKFLOW_RESTRICTABLE_TOOL_NAMES.filter(
  (name) => !WORKFLOW_READONLY_DISALLOWED_TOOLS.includes(name),
)

/** 临时原子 worker 的合成 id：与 agent/subagent 的真实 workerId 命名空间隔离，避免冲突。 */
export function workflowAtomicMemberId(nodeId: string): string {
  return `workflow-atomic:${nodeId}`
}

/**
 * 判断某原子节点这一轮该走「真实执行」还是「静态回显」。
 * - config.execution === 'static' 强制走旧的静态回显（兼容/降本）。
 * - config.execution === 'auto'（或缺省）时，input/skill/tool/mcp/plan/review/artifact 走真实执行；
 *   其中 artifact 只有配了 exportPath 或没配 value 静态值时才需要 LLM 产出内容——
 *   为保持行为可预期，这里对 auto 的 artifact 也一律走真实执行，导出/透传在回调里再分流。
 *   input 走 LLM 结构化解析（拆解 prompt/objective/constraint/value 为结构化 JSON），
 *   解析失败或 execution:'static' 时回落透传 getDefaultWorkflowAtomicContent。
 */
export function shouldRunWorkflowAtomicNodeAsAgent(node: NormalizedWorkflowNode): boolean {
  const execution = typeof node.config.execution === 'string' ? node.config.execution.trim() : ''
  if (execution === 'static') return false
  return WORKFLOW_LLM_ATOMIC_KINDS.has(node.kind)
}

/**
 * 为原子节点构造临时受限 worker：复用 createWorkflowSubagentMember 的 provider/model 继承逻辑，
 * 再按节点类型收窄能力面：
 * - skill：只挂节点所选 skillIds；tool：把 toolIds 交给 metadata（executeMemberTurn 换算 disallowedTools）。
 *   MCP 不再按 Agent 或节点收窄，所有已启用的应用 MCP 都由运行时统一挂载。
 * - input / plan / review：纯 LLM 任务（结构化解析 / 计划 / 复核），不需要外部写与执行类工具——
 *   额外用只读 toolIds 覆盖，禁掉 Write/Edit/Bash 等。
 */
export function createWorkflowAtomicMember(node: NormalizedWorkflowNode, hostAgent: AgentItem): AgentItem {
  const workerId = workflowAtomicMemberId(node.id)
  const base = createWorkflowSubagentMember(node, hostAgent, workerId)
  if (node.kind !== 'input' && node.kind !== 'route' && node.kind !== 'plan' && node.kind !== 'review') {
    return base
  }
  // input/route/plan/review：若节点自己配了 toolIds 就取「所选 ∩ 只读集」，否则直接用整个只读集。
  const configured = stringArrayConfig(node.config.toolIds)
  const readonlyIds =
    configured.length > 0
      ? configured.filter((id) => WORKFLOW_READONLY_ALLOWED_TOOL_IDS.includes(id))
      : WORKFLOW_READONLY_ALLOWED_TOOL_IDS
  return {
    ...base,
    metadata: {
      ...base.metadata,
      toolIds: readonlyIds,
    },
  }
}

/**
 * 原子节点真实执行时给临时 worker 的指令：config.prompt 优先（缺省用标题），
 * 再拼上工作流目标与上游 inputs——与 agent 节点派发路径的指令组装保持一致。
 *
 * 特例：input 节点要求 LLM 把节点的 prompt/objective/constraint/value 拆解为结构化 JSON，
 * 输出格式严格、只输出 JSON、不带任何解释（解析失败由 executeAtomicNode 回落透传兜底）。
 */
export function buildWorkflowAtomicInstruction(request: {
  kind?: WorkflowNodeKind
  title: string
  objective: string
  inputs: Record<string, unknown>
  config: Record<string, unknown>
}): string {
  if (request.kind === 'input') {
    return buildWorkflowInputStructuredInstruction(request)
  }
  if (request.kind === 'route') {
    return buildWorkflowRouteDecisionInstruction(request)
  }
  const prompt =
    typeof request.config.prompt === 'string' && request.config.prompt.trim().length > 0
      ? request.config.prompt.trim()
      : request.title
  const parts = [prompt]
  if (request.objective.trim().length > 0) {
    parts.push(`[Workflow objective]\n${request.objective.trim()}`)
  }
  const inputKeys = Object.keys(request.inputs)
  if (inputKeys.length > 0) {
    parts.push(`[Upstream inputs]\n${JSON.stringify(request.inputs)}`)
  }
  return parts.join('\n\n')
}

export function buildWorkflowRouteDecisionInstruction(request: {
  title: string
  objective: string
  inputs: Record<string, unknown>
  config: Record<string, unknown>
}): string {
  const title = request.title.trim().length > 0 ? request.title.trim() : '(untitled route)'
  const prompt =
    typeof request.config.prompt === 'string' && request.config.prompt.trim().length > 0
      ? request.config.prompt.trim()
      : '根据工作流目标和上游输入选择一个后续路由。'
  const options = normalizeWorkflowRouteOptions(request.config)
  const optionLines =
    options.length > 0
      ? options
          .map((option) => {
            const label = option.label != null ? ` (${option.label})` : ''
            const description = option.description != null ? `: ${option.description}` : ''
            return `- ${option.value}${label}${description}`
          })
          .join('\n')
      : '- 任意一个非空分支值'
  const parts = [
    `你是工作流「${title}」的路由节点。`,
    prompt,
    '',
    '[Allowed route values]',
    optionLines,
  ]
  if (request.objective.trim().length > 0) {
    parts.push('', '[Workflow objective]', request.objective.trim())
  }
  const inputKeys = Object.keys(request.inputs)
  if (inputKeys.length > 0) {
    parts.push('', '[Upstream inputs]', JSON.stringify(request.inputs))
  }
  parts.push(
    '',
    '[Output format]',
    '严格只输出一个分支 value 本身，不要 JSON、不要解释、不要标点、不要换行。',
  )
  return parts.join('\n')
}

/**
 * input 节点的结构化解析指令：把节点已有的 prompt/value/objective/constraint 喂给 LLM，
 * 要求输出固定 schema 的 JSON（objective/constraints/deliverables），且只输出 JSON、不要解释。
 */
export function buildWorkflowInputStructuredInstruction(request: {
  title: string
  objective: string
  inputs: Record<string, unknown>
  config: Record<string, unknown>
}): string {
  const fields: string[] = []
  const prompt = typeof request.config.prompt === 'string' ? request.config.prompt.trim() : ''
  if (prompt.length > 0) fields.push(`prompt: ${prompt}`)
  const value = request.config.value
  if (value != null) {
    fields.push(typeof value === 'string' ? `value: ${value}` : `value: ${JSON.stringify(value)}`)
  }
  const objective =
    typeof request.config.objective === 'string' ? request.config.objective.trim() : ''
  if (objective.length > 0) {
    fields.push(`objective: ${objective}`)
  } else if (request.objective.trim().length > 0) {
    fields.push(`objective: ${request.objective.trim()}`)
  }
  const constraint = request.config.constraint
  if (constraint != null) {
    fields.push(
      typeof constraint === 'string'
        ? `constraint: ${constraint}`
        : `constraint: ${JSON.stringify(constraint)}`,
    )
  }
  const title = request.title.trim().length > 0 ? request.title.trim() : '(untitled input)'
  const inputKeys = Object.keys(request.inputs)
  if (inputKeys.length > 0) {
    fields.push(`upstream_inputs: ${JSON.stringify(request.inputs)}`)
  }
  return [
    `你是工作流「${title}」输入节点的结构化解析器。`,
    '请基于以下节点配置，把用户意图拆解为结构化 JSON。',
    '',
    '[Node fields]',
    fields.length > 0 ? fields.join('\n') : '(no fields configured)',
    '',
    '[Output format]',
    '严格输出以下 JSON（不要 ```json 围栏、不要任何解释文字、只输出 JSON 本身）：',
    '{"objective":"...","constraints":["..."],"deliverables":["..."]}',
    '- objective：本次输入的核心目标（一句话）。',
    '- constraints：约束/限制条件数组（每条一句话；没有就给空数组）。',
    '- deliverables：期望产出物数组（每条一句话；没有就给空数组）。',
  ].join('\n')
}

/**
 * artifact 节点的导出目标解析：config.exportPath 配置后，把 resolve 后的绝对路径交给调用方写文件。
 * 防路径穿越——resolve 后必须仍在 workspaceRootPath 内，否则返回 null 并给出原因。
 */
export function resolveWorkflowArtifactExportPath(
  config: Record<string, unknown>,
  workspaceRootPath: string,
): { ok: true; absolutePath: string } | { ok: false; reason?: string } {
  const raw = typeof config.exportPath === 'string' ? config.exportPath.trim() : ''
  if (raw.length === 0) return { ok: false }
  if (path.isAbsolute(raw)) return { ok: false, reason: 'exportPath 必须是工作区相对路径' }
  const root = path.resolve(workspaceRootPath)
  const absolutePath = path.resolve(root, raw)
  // 用 root + path.sep 前缀判定，避免 /root-evil 这类同前缀目录被误判为在 root 内。
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) {
    return { ok: false, reason: 'exportPath 超出工作区范围' }
  }
  return { ok: true, absolutePath }
}
