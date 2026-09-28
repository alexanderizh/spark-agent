/**
 * @module tool-recovery-registry
 *
 * 工具恢复策略目录（方案 §8）。
 *
 * 统一在现有工具名之上声明 sideEffect / replayPolicy / 幂等与查询能力。
 * 未声明的第三方 MCP / Connector 默认采用保守策略：
 * external_irreversible + confirm（绝不自动重跑）。
 */

import {
  CONSERVATIVE_TOOL_RECOVERY_POLICY,
  type ToolRecoveryPolicy,
  type ToolSideEffectClass,
} from '@spark/protocol'

/** 只读/查询类内置工具：安全重跑。 */
const SAFE_QUERY_POLICY: ToolRecoveryPolicy = {
  sideEffect: 'none',
  replayPolicy: 'safe',
  supportsIdempotencyKey: false,
  supportsStatusQuery: true,
  supportsCompensation: false,
  definitionVersion: 'builtin',
}

/** 工作区写入类工具：副作用本地、可由工作区快照兜底，重放前需校验。 */
const WORKSPACE_POLICY: ToolRecoveryPolicy = {
  sideEffect: 'workspace',
  replayPolicy: 'confirm',
  supportsIdempotencyKey: false,
  supportsStatusQuery: false,
  supportsCompensation: true,
  definitionVersion: 'builtin',
}

/** 外部系统调用：保守确认。 */
const EXTERNAL_CONFIRM_POLICY: ToolRecoveryPolicy = {
  sideEffect: 'external_irreversible',
  replayPolicy: 'confirm',
  supportsIdempotencyKey: false,
  supportsStatusQuery: false,
  supportsCompensation: false,
  definitionVersion: 'builtin',
}

/** 媒体异步生成：已有 provider task id 时只轮询，不重复 submit（L3 样板）。 */
const MEDIA_QUERY_THEN_RESUME_POLICY: ToolRecoveryPolicy = {
  sideEffect: 'external_reversible',
  replayPolicy: 'query_then_resume',
  supportsIdempotencyKey: false,
  supportsStatusQuery: true,
  supportsCompensation: false,
  definitionVersion: 'builtin',
}

const BUILTIN_TOOL_POLICIES: Record<string, ToolRecoveryPolicy> = {
  // 只读 / 查询 / 搜索
  Read: SAFE_QUERY_POLICY,
  Glob: SAFE_QUERY_POLICY,
  Grep: SAFE_QUERY_POLICY,
  LS: SAFE_QUERY_POLICY,
  ls: SAFE_QUERY_POLICY,
  'list_files': SAFE_QUERY_POLICY,
  search: SAFE_QUERY_POLICY,
  'web_search': SAFE_QUERY_POLICY,
  WebSearch: SAFE_QUERY_POLICY,
  WebFetch: SAFE_QUERY_POLICY,
  'web-reader': SAFE_QUERY_POLICY,
  TodoRead: SAFE_QUERY_POLICY,
  'task_list': SAFE_QUERY_POLICY,
  'session-history-search': SAFE_QUERY_POLICY,
  'search_memory': SAFE_QUERY_POLICY,
  'recall_memory': SAFE_QUERY_POLICY,
  'list_models': SAFE_QUERY_POLICY,
  'board_list': SAFE_QUERY_POLICY,
  'board_get': SAFE_QUERY_POLICY,
  'list_tasks': SAFE_QUERY_POLICY,
  'providers_list': SAFE_QUERY_POLICY,
  'mcp_list': SAFE_QUERY_POLICY,
  'skills_list': SAFE_QUERY_POLICY,
  'agents_list': SAFE_QUERY_POLICY,
  'teams_list': SAFE_QUERY_POLICY,
  'workflows_list': SAFE_QUERY_POLICY,
  'describe_model': SAFE_QUERY_POLICY,
  'github_status': SAFE_QUERY_POLICY,
  'github_get_issue': SAFE_QUERY_POLICY,
  'github_get_pull_request': SAFE_QUERY_POLICY,
  'github_get_repository': SAFE_QUERY_POLICY,
  'github_list_issues': SAFE_QUERY_POLICY,
  'github_list_pull_requests': SAFE_QUERY_POLICY,
  'github_list_repositories': SAFE_QUERY_POLICY,
  'github_read_repository_file': SAFE_QUERY_POLICY,
  'spark_tool_help': SAFE_QUERY_POLICY,
  'render_diagram': SAFE_QUERY_POLICY,

  // 工作区写入
  Write: WORKSPACE_POLICY,
  Edit: WORKSPACE_POLICY,
  NotebookEdit: WORKSPACE_POLICY,
  'write_file': WORKSPACE_POLICY,
  'edit_file': WORKSPACE_POLICY,
  MultiEdit: WORKSPACE_POLICY,
  Bash: {
    sideEffect: 'workspace',
    replayPolicy: 'confirm',
    supportsIdempotencyKey: false,
    supportsStatusQuery: false,
    supportsCompensation: false,
    definitionVersion: 'builtin',
  },

  // 外部副作用（发送/发布/删除）
  'send_message': EXTERNAL_CONFIRM_POLICY,
  'push_notification': EXTERNAL_CONFIRM_POLICY,
  'github_upsert_repository_file': EXTERNAL_CONFIRM_POLICY,
  'github_create_branch': EXTERNAL_CONFIRM_POLICY,
  'github_create_issue': EXTERNAL_CONFIRM_POLICY,
  'github_create_pull_request': EXTERNAL_CONFIRM_POLICY,
  'github_comment_issue': EXTERNAL_CONFIRM_POLICY,
  'github_comment_pull_request': EXTERNAL_CONFIRM_POLICY,
  'github_update_issue': EXTERNAL_CONFIRM_POLICY,
  'board_create': EXTERNAL_CONFIRM_POLICY,
  'board_update': EXTERNAL_CONFIRM_POLICY,
  'board_delete': EXTERNAL_CONFIRM_POLICY,
  'board_batch_create': EXTERNAL_CONFIRM_POLICY,
  'board_batch_update': EXTERNAL_CONFIRM_POLICY,
  'board_batch_delete': EXTERNAL_CONFIRM_POLICY,
  'board_permanent_delete': EXTERNAL_CONFIRM_POLICY,

  // 媒体异步任务（只轮询）
  'get_task': MEDIA_QUERY_THEN_RESUME_POLICY,
  'cancel_task': EXTERNAL_CONFIRM_POLICY,
  'generate_image': MEDIA_QUERY_THEN_RESUME_POLICY,
  'edit_image': MEDIA_QUERY_THEN_RESUME_POLICY,
  'generate_video': MEDIA_QUERY_THEN_RESUME_POLICY,
  'generate_audio': MEDIA_QUERY_THEN_RESUME_POLICY,
  'transcribe_audio': MEDIA_QUERY_THEN_RESUME_POLICY,

  // 子 Agent 派发：本身可重试，但子 Run 有独立恢复
  Agent: {
    sideEffect: 'workspace',
    replayPolicy: 'confirm',
    supportsIdempotencyKey: false,
    supportsStatusQuery: true,
    supportsCompensation: false,
    definitionVersion: 'builtin',
  },
  Task: {
    sideEffect: 'workspace',
    replayPolicy: 'confirm',
    supportsIdempotencyKey: false,
    supportsStatusQuery: true,
    supportsCompensation: false,
    definitionVersion: 'builtin',
  },
}

/** 读取工具恢复策略；未声明的（含第三方 MCP）使用保守默认。 */
export function getToolRecoveryPolicy(toolName: string, source?: 'builtin' | 'mcp'): ToolRecoveryPolicy {
  if (source === 'mcp') {
    // MCP 工具名可能带 server 前缀；先查全名，再查裸名，最后保守。
    const bare = toolName.includes('__') ? toolName.split('__').pop()! : toolName
    return BUILTIN_TOOL_POLICIES[toolName] ?? BUILTIN_TOOL_POLICIES[bare] ?? CONSERVATIVE_TOOL_RECOVERY_POLICY
  }
  return BUILTIN_TOOL_POLICIES[toolName] ?? CONSERVATIVE_TOOL_RECOVERY_POLICY
}

/** 快速判断：该工具是否可能产生外部副作用（用于 Phase 1 无 EffectJournal 时的证明）。 */
export function mayHaveExternalSideEffect(toolName: string, source?: 'builtin' | 'mcp'): boolean {
  const sideEffect: ToolSideEffectClass = getToolRecoveryPolicy(toolName, source).sideEffect
  return sideEffect === 'external_reversible' || sideEffect === 'external_irreversible'
}
