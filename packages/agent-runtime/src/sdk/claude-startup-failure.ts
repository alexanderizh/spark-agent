import type { SDKStartupFailureReason } from './types.js'

/**
 * Claude CLI 已知启动失败的结构化分诊（SDK 0.3.278+）。
 *
 * startup_failure_reason 由 CLI 写在零值 error_during_execution result 上
 * （宿主需设置 CLAUDE_CODE_STARTUP_FAILURE_RESULTS，executor 已统一注入）；
 * 未知原因与旧版本 CLI 缺省——调用方回落既有错误路径。
 */

export interface ClaudeStartupFailureDiagnosis {
  title: string
  message: string
  retryable: boolean
  actionHint: string
}

const STARTUP_FAILURE_DIAGNOSES: Record<SDKStartupFailureReason, ClaudeStartupFailureDiagnosis> = {
  org_pin_api_key_conflict: {
    title: '组织策略与 API Key 冲突',
    message: '组织固定了指定的 API 端点，与当前提供的 API Key 冲突。',
    retryable: false,
    actionHint: '改用组织指定的端点与凭据，或切换到不受组织策略限制的账号。',
  },
  org_verify_failed: {
    title: '组织校验未通过',
    message: 'Claude 无法完成当前组织策略校验，进程拒绝启动。',
    retryable: true,
    actionHint: '检查网络与组织策略配置后重试；持续失败请联系组织管理员。',
  },
  org_pin_mismatch: {
    title: '组织策略不匹配',
    message: '当前配置与组织固定要求（模型/端点）不一致。',
    retryable: false,
    actionHint: '按组织要求调整模型或端点配置后再启动会话。',
  },
  managed_settings_invalid: {
    title: '托管设置文件无效',
    message: '企业托管 settings 文件解析失败，CLI 拒绝启动。',
    retryable: false,
    actionHint: '修复或移除无效的托管 settings 文件后重试。',
  },
  remote_settings_required_unavailable: {
    title: '远程设置不可用',
    message: '策略要求加载远程设置，但远程设置服务当前不可达。',
    retryable: true,
    actionHint: '检查网络连接后重试；确认远程设置服务状态。',
  },
  gateway_signin_required: {
    title: '需要网关登录',
    message: '请求需要先完成网关（gateway）登录。',
    retryable: false,
    actionHint: '完成网关登录后重新启动会话。',
  },
  gateway_access_denied: {
    title: '网关拒绝访问',
    message: '网关拒绝了当前账号的访问请求。',
    retryable: false,
    actionHint: '确认账号权限，或联系网关管理员开通访问。',
  },
  proxy_invalid: {
    title: '代理配置无效',
    message: '代理（HTTPS_PROXY 等）配置无效，无法建立连接。',
    retryable: false,
    actionHint: '修正代理地址/端口配置后重试。',
  },
  temp_dir_unusable: {
    title: '临时目录不可用',
    message: '系统临时目录不可写或不可用，CLI 无法启动。',
    retryable: false,
    actionHint: '检查 TMPDIR 指向的目录权限与磁盘空间。',
  },
  cwd_unavailable: {
    title: '工作目录不可用',
    message: '会话工作目录不存在或不可访问。',
    retryable: false,
    actionHint: '确认工作区路径存在，或重新选择工作区。',
  },
  shell_tool_missing: {
    title: 'Shell 工具缺失',
    message: 'CLI 依赖的 shell 工具在当前环境不可用。',
    retryable: false,
    actionHint: '检查系统 shell（bash/zsh）安装与 PATH 配置。',
  },
  session_held_by_background: {
    title: '会话被后台占用',
    message: '目标会话正被一个后台进程持有，无法按当前方式恢复。',
    retryable: true,
    actionHint: '结束后台占用进程，或等待其完成后再开启会话。',
  },
  worktree_resume_refused: {
    title: 'Worktree 恢复被拒绝',
    message: '目标 worktree 状态不允许恢复该会话。',
    retryable: false,
    actionHint: '检查 worktree 是否被清理或切换，必要时新开会话。',
  },
  worktree_unverified: {
    title: 'Worktree 未通过校验',
    message: '恢复的 worktree 未能通过完整性校验。',
    retryable: false,
    actionHint: '重建 worktree 或从主仓库重新创建会话。',
  },
  cli_version_too_old: {
    title: 'CLI 版本过旧',
    message: '当前 Claude CLI 版本低于会话恢复所需的最低版本。',
    retryable: false,
    actionHint: '在「设置 → 完整性」升级 Claude CLI 运行时后重试。',
  },
  bypass_root: {
    title: 'root 用户禁止绕过权限',
    message: '以 root 身份运行时不允许启用权限绕过模式。',
    retryable: false,
    actionHint: '切换到非 root 用户运行，或关闭 bypassPermissions 模式。',
  },
}

export function isSDKStartupFailureReason(value: unknown): value is SDKStartupFailureReason {
  return typeof value === 'string' && value in STARTUP_FAILURE_DIAGNOSES
}

export function describeClaudeStartupFailure(
  reason: SDKStartupFailureReason,
): ClaudeStartupFailureDiagnosis {
  return STARTUP_FAILURE_DIAGNOSES[reason]
}

/** agent_error 事件用的稳定错误码：CLAUDE_STARTUP_FAILED_<REASON>。 */
export function claudeStartupFailureErrorCode(reason: SDKStartupFailureReason): string {
  return `CLAUDE_STARTUP_FAILED_${reason.toUpperCase()}`
}
