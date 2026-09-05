/**
 * Composer 下拉菜单的通用选项类型 + 权限模式选项。
 *
 * 统一维护 Claude/Codex 权限选项，供主对话框、设置和 Agent 配置等入口复用，
 * 避免用户看到的权限语义与运行时映射漂移。
 */
import type { SessionPermissionMode, SessionAgentAdapter } from '@spark/protocol'

export type ComposerMenuOption = {
  value: SessionPermissionMode
  label: string
  description: string
  tone?: 'default' | 'auto' | 'danger'
}

export const CLAUDE_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption> = [
  { value: 'claude-ask', label: '请求批准', description: '每次工具执行前确认' },
  { value: 'claude-plan', label: '计划模式', description: '先产出计划，再批准执行' },
  {
    value: 'claude-auto-edits',
    label: '自动编辑',
    description: '自动批准文件编辑',
    tone: 'auto',
  },
  {
    value: 'claude-auto',
    label: '自动审批',
    description: '使用自动权限策略',
    tone: 'auto',
  },
  {
    value: 'claude-bypass',
    label: '完全访问',
    description: '完全由 agent 执行',
    tone: 'danger',
  },
]

export const CODEX_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption> = [
  {
    value: 'codex-default',
    label: '按需批准',
    description: 'workspace-write；工作区内安全写入自动执行，越界操作请求批准',
  },
  {
    value: 'codex-auto-review',
    label: '替我批准',
    description: 'workspace-write；越界操作交由 Codex 自动审查',
    tone: 'auto',
  },
  {
    value: 'codex-full-access',
    label: '完全访问',
    description: 'danger-full-access；允许修改 .git 和工作区外文件',
    tone: 'danger',
  },
]

export const SPARK_PERMISSION_MODE_OPTIONS: Array<ComposerMenuOption> = [
  {
    value: 'spark-default',
    label: '按需批准',
    description: 'default；安全工具自动执行，敏感操作请求批准',
  },
  {
    value: 'spark-accept-edits',
    label: '自动编辑',
    description: 'acceptEdits；自动批准文件编辑',
    tone: 'auto',
  },
  {
    value: 'spark-plan',
    label: '计划模式',
    description: 'plan；先产出计划，批准后再执行',
  },
  {
    value: 'spark-bypass',
    label: '完全访问',
    description: 'bypass；完全由 agent 执行',
    tone: 'danger',
  },
]

/** 按 adapter 返回可选的权限模式（codex 与 claude 系列互斥） */
export function getPermissionModeOptions(adapter: SessionAgentAdapter): Array<ComposerMenuOption> {
  if (adapter === 'codex') return CODEX_PERMISSION_MODE_OPTIONS
  if (adapter === 'spark') return SPARK_PERMISSION_MODE_OPTIONS
  return CLAUDE_PERMISSION_MODE_OPTIONS
}

/** 校验权限模式是否适配当前 adapter，不适配则回退到该 adapter 的默认值 */
export function getValidPermissionMode(
  value: SessionPermissionMode | undefined,
  adapter: SessionAgentAdapter,
): SessionPermissionMode {
  const options = getPermissionModeOptions(adapter)
  return options.some((option) => option.value === value)
    ? (value as SessionPermissionMode)
    : (options[0]?.value ?? 'claude-ask')
}
