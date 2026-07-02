/**
 * Composer 下拉菜单的通用选项类型 + 权限模式选项。
 *
 * 与 ChatView.tsx 内部的私有定义保持一致（claude-ask / auto-edits / plan / auto / bypass；
 * codex-default / auto-review / full-access），抽出共享给画布 Agent 弹窗等嵌入式场景，
 * 避免重复维护。ChatView 暂未改用本文件（避免牵动主对话框回归），未来可统一。
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
  { value: 'codex-default', label: 'Default', description: '使用 Codex CLI 默认权限策略' },
  {
    value: 'codex-auto-review',
    label: 'Auto review',
    description: '允许自动读写，保留关键确认',
    tone: 'auto',
  },
  {
    value: 'codex-full-access',
    label: 'Full access',
    description: '危险：Codex CLI 完全访问',
    tone: 'danger',
  },
]

/** 按 adapter 返回可选的权限模式（codex 与 claude 系列互斥） */
export function getPermissionModeOptions(
  adapter: SessionAgentAdapter,
): Array<ComposerMenuOption> {
  return adapter === 'codex' ? CODEX_PERMISSION_MODE_OPTIONS : CLAUDE_PERMISSION_MODE_OPTIONS
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
