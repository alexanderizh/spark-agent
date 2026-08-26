import type { ReasoningEffort } from '../llm/types.js'

/**
 * Single source of truth for the interactive TUI slash commands: drives Tab
 * completion, /help text, and the command-dispatch switch so the three can
 * never drift.
 */
export const SLASH_COMMANDS: readonly {
  readonly name: string
  readonly summary: string
}[] = [
  { name: '/help', summary: '显示命令与快捷键' },
  { name: '/status', summary: '会话 id、排队 turn、事件数' },
  { name: '/model', summary: '切换模型或配置本地渠道' },
  { name: '/perm', summary: '切换本会话权限策略(default/编辑自动/计划/绕过)' },
  { name: '/effort', summary: '切换推理强度(off/low/medium/high)' },
  { name: '/clear', summary: '开启全新会话' },
  { name: '/exit', summary: '退出(Ctrl+C 两次同效)' },
]

export function helpLine(): string {
  return SLASH_COMMANDS.map((command) => command.name).join(' ')
}

export function helpDetail(): string {
  return SLASH_COMMANDS.map((command) => `${command.name} ${command.summary}`).join(' · ')
}

/** Ordered cycle for the `/effort` command; 'auto' = protocol default. */
export const EFFORT_CYCLE: readonly (ReasoningEffort | 'auto')[] = [
  'auto',
  'off',
  'low',
  'medium',
  'high',
]

export function cycleEffort(current: ReasoningEffort | undefined): ReasoningEffort | undefined {
  const index = EFFORT_CYCLE.indexOf(current ?? 'auto')
  const next = EFFORT_CYCLE[(index + 1) % EFFORT_CYCLE.length] ?? 'auto'
  return next === 'auto' ? undefined : next
}

export function effortLabel(effort: ReasoningEffort | undefined): string {
  return effort ?? 'auto'
}
