import type {
  BindingChangeBlocker,
  EffectiveWorkflowSummary,
  SessionWorkflowBinding,
  WorkflowPreflightIssue,
} from '@spark/protocol'

export function workflowBindingLabel(
  binding: SessionWorkflowBinding | null,
  effective: EffectiveWorkflowSummary,
): string {
  if (binding?.mode === 'disabled') return '工作流已停用'
  if (effective.workflowName == null) return binding == null ? '工作流' : '继承 · 无工作流'
  if (binding?.mode === 'override') return `会话 · ${effective.workflowName}`
  return `Agent · ${effective.workflowName}`
}

export function workflowExecutionModeLabel(
  mode: EffectiveWorkflowSummary['executionMode'],
): string {
  if (mode === 'workflow_run') return '托管执行'
  if (mode === 'codex_guided' || mode === 'guided') return '引导执行'
  return '不执行'
}

export function localizeBindingBlocker(blocker: BindingChangeBlocker): string {
  const messages: Record<BindingChangeBlocker['code'], string> = {
    session_busy: '会话正在运行或已归档',
    turn_queue_not_empty: '仍有消息等待处理',
    approval_pending: '请先处理当前审批',
    question_pending: '请先回答当前问题',
    goal_active: '当前目标仍在进行中',
    workflow_run_working: '工作流正在执行',
    binding_conflict: '配置已在其他窗口更新',
  }
  return messages[blocker.code]
}

export function localizeBindingError(error: unknown): string {
  if (Array.isArray(error)) {
    const issue = error.find(isWorkflowPreflightIssue)
    return issue == null ? '工作流配置保存失败。' : localizePreflightIssue(issue)
  }
  if (isBindingChangeBlocker(error)) return localizeBindingBlocker(error)
  const message = error instanceof Error ? error.message : String(error)
  if (/conflict|其他窗口|发生变化/i.test(message)) return '配置已发生变化，请刷新后重试。'
  if (/disabled|尚未启用/i.test(message)) return '会话工作流功能当前未启用。'
  return message || '工作流配置保存失败。'
}

function isBindingChangeBlocker(value: unknown): value is BindingChangeBlocker {
  if (value == null || typeof value !== 'object') return false
  const code = (value as { code?: unknown }).code
  return (
    typeof code === 'string' &&
    [
      'session_busy',
      'turn_queue_not_empty',
      'approval_pending',
      'question_pending',
      'goal_active',
      'workflow_run_working',
      'binding_conflict',
    ].includes(code)
  )
}

export function localizePreflightIssue(issue: WorkflowPreflightIssue): string {
  const dependency = issue.dependencyId == null ? '' : `「${issue.dependencyId}」`
  const node = issue.nodeId == null ? '' : `（节点 ${issue.nodeId}）`
  const messages: Record<WorkflowPreflightIssue['code'], string> = {
    workflow_not_found: '工作流不存在或已删除。',
    workflow_disabled: '工作流已停用。',
    workflow_not_active: `工作流尚未发布（当前状态：${String(issue.params?.status ?? '未知')}）。`,
    workflow_run_snapshot_invalid: '可恢复运行的工作流快照已损坏。',
    graph_cycle: `工作流存在循环依赖${formatScope(issue)}。`,
    invalid_condition_reference: `工作流条件引用了未声明的状态键${formatParam(issue, 'key')}${node}。`,
    invalid_loop_body: `循环体配置无效${formatScope(issue)}${node}。`,
    unsupported_node_kind: `工作流包含不支持的节点类型${formatParam(issue, 'kind')}${node}。`,
    missing_agent: `找不到所需 Agent ${dependency}${node}。`,
    disabled_agent: `所需 Agent ${dependency}已停用${node}。`,
    missing_required_skill: `找不到或未启用所需 Skill ${dependency}${node}。`,
    missing_required_tool: `找不到或未启用所需工具 ${dependency}${node}。`,
    missing_required_mcp: `找不到或未启用所需 MCP ${dependency}${node}。`,
    provider_uses_host_fallback: '节点将使用 Host 的 Provider。',
    optional_mcp_unavailable: `可选 MCP ${dependency}当前不可用。`,
    workflow_archived_for_existing_binding: '当前绑定的工作流已归档，仅保留历史说明。',
    definition_newer_than_resumable_run: '工作流定义已更新，恢复时仍使用原运行快照。',
    bundle_dependency_unresolved: `工作流包依赖 ${dependency}当前无法解析。`,
  }
  return messages[issue.code] ?? `工作流检查未通过（${issue.code}）。`
}

function isWorkflowPreflightIssue(value: unknown): value is WorkflowPreflightIssue {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as { code?: unknown }).code === 'string'
  )
}

function formatScope(issue: WorkflowPreflightIssue): string {
  return typeof issue.params?.scope === 'string' ? `（${issue.params.scope}）` : ''
}

function formatParam(issue: WorkflowPreflightIssue, key: string): string {
  const value = issue.params?.[key]
  return typeof value === 'string' && value.length > 0 ? `「${value}」` : ''
}
