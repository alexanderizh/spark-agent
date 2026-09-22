import { WorkflowGraphSchema, formatWorkflowGraphIssues } from '@spark/protocol'
import {
  detectWorkflowConditionReferenceErrors,
  detectWorkflowGraphCycles,
  detectWorkflowUnsupportedNodeKinds,
  formatWorkflowConditionReferenceError,
  formatWorkflowCycleError,
  formatWorkflowUnsupportedNodeKindError,
  normalizeWorkflowGraph,
} from '@spark/agent-runtime'

/**
 * 工作流图写入前的保存闸门，`workflow:create` / `workflow:update` 与团队资产安装工作流
 * 共用同一实现。两层校验并存、互不替代：
 *
 * - `assertWorkflowGraphSchema`（形状层）：kind 枚举、config 字段白名单（strict，拒未知
 *   键/类型错/超界）、边条件结构、递归 loop 体；规则定义在 @spark/protocol 的
 *   WorkflowGraphSchema。LLM（nl2workflow 方向）拼错的 kind/字段名/值类型在此被明确
 *   拒绝，不再静默降级落库。
 * - `assertWorkflowGraphValid`（拓扑层）：未知节点类型 + 规范化 + 环检测 + 条件引用检测。
 *   三类问题都只在运行期才暴露、且届时报错难以定位：
 *   · 未知节点类型：`normalizeWorkflowGraph` 会把未知 kind 静默降级成 `agent` 节点，
 *     图里写着 `output` 却按 agent 跑，直到会话挂载预检才以 unsupported_node_kind 暴露；
 *   · 环：运行时只能以 workflow_deadlock 失败，报错是英文裸 node id；
 *   · 条件引用：条件/退出条件引用了没有任何节点声明的状态键。
 *
 * 两层都在持久化前拦截，报错带字段路径/节点标题便于用户定位；executor 内部的
 * `normalizeWorkflowGraph` 兜底仍然保留，用于旧数据容错。
 */
export function assertWorkflowGraphValid(graph: unknown): void {
  if (graph == null) return
  const graphInput = graph as Parameters<typeof normalizeWorkflowGraph>[0]
  const unsupportedKinds = detectWorkflowUnsupportedNodeKinds(graphInput)
  if (unsupportedKinds.length > 0) {
    throw new Error(formatWorkflowUnsupportedNodeKindError(unsupportedKinds))
  }
  const normalized = normalizeWorkflowGraph(graphInput)
  const cycleReports = detectWorkflowGraphCycles(normalized)
  if (cycleReports.length > 0) throw new Error(formatWorkflowCycleError(cycleReports))
  const referenceReports = detectWorkflowConditionReferenceErrors(normalized)
  if (referenceReports.length > 0) {
    throw new Error(formatWorkflowConditionReferenceError(referenceReports))
  }
}

/** 保存前形状校验：LLM 拼错的 kind、config 字段名、值类型在此明确拒绝。 */
export function assertWorkflowGraphSchema(graph: unknown): void {
  if (graph == null) return
  const parsed = WorkflowGraphSchema.safeParse(graph)
  if (!parsed.success) {
    throw new Error(`工作流图校验失败：${formatWorkflowGraphIssues(parsed.error.issues)}`)
  }
}

/** 只读校验诊断条目（workflow:validate 返回结构，供工作流 Agent 修复回路消费） */
export interface WorkflowGraphDiagnostic {
  severity: 'error' | 'warning'
  source: 'schema' | 'topology'
  code: string
  path?: string
  message: string
}

/**
 * 只读校验（E2-2）：与保存闸门同一套规则，但不抛错、返回结构化诊断——
 * 工作流 Agent 的 workflow_validate 工具在落库前自检用，E2-3 修复熔断
 * 直接把 diagnostics 回喂 LLM。
 */
export function validateWorkflowGraph(graph: unknown): {
  ok: boolean
  diagnostics: WorkflowGraphDiagnostic[]
} {
  const diagnostics: WorkflowGraphDiagnostic[] = []
  if (graph == null) {
    return {
      ok: false,
      diagnostics: [
        { severity: 'error', source: 'schema', code: 'graph_missing', message: '缺少工作流图' },
      ],
    }
  }
  const graphInput = graph as Parameters<typeof normalizeWorkflowGraph>[0]
  // 形状层：逐条收集 schema 违规（不抛，让修复回路拿到完整问题清单）
  const parsed = WorkflowGraphSchema.safeParse(graphInput)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diagnostics.push({
        severity: 'error',
        source: 'schema',
        code: 'schema_invalid',
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })
    }
  }
  // 拓扑层：与 assertWorkflowGraphValid 同源，三类问题逐条收集
  const unsupportedKinds = detectWorkflowUnsupportedNodeKinds(graphInput)
  if (unsupportedKinds.length > 0) {
    diagnostics.push({
      severity: 'error',
      source: 'topology',
      code: 'unsupported_node_kind',
      message: formatWorkflowUnsupportedNodeKindError(unsupportedKinds),
    })
  }
  const normalized = normalizeWorkflowGraph(graphInput)
  const cycleReports = detectWorkflowGraphCycles(normalized)
  if (cycleReports.length > 0) {
    diagnostics.push({
      severity: 'error',
      source: 'topology',
      code: 'graph_cycle',
      message: formatWorkflowCycleError(cycleReports),
    })
  }
  const referenceReports = detectWorkflowConditionReferenceErrors(normalized)
  if (referenceReports.length > 0) {
    diagnostics.push({
      severity: 'error',
      source: 'topology',
      code: 'condition_reference_missing',
      message: formatWorkflowConditionReferenceError(referenceReports),
    })
  }
  return { ok: diagnostics.length === 0, diagnostics }
}
