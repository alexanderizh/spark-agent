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
  { name: '/perm', summary: '选择权限策略(请求批准/自动权限/计划/完全访问)' },
  { name: '/effort', summary: '选择推理强度(auto/low/medium/high/max/off)' },
  { name: '/update', summary: '检查并安装新版本(--check 仅检查)' },
  { name: '/clear', summary: '开启全新会话' },
  { name: '/exit', summary: '退出(Ctrl+C 两次同效)' },
]

/**
 * Keyboard shortcuts rendered by /help. Every entry here is implemented in
 * InputEditor (editing/intent keys) or SparkTuiApp (mode toggles); keep this
 * table in lockstep when adding a binding.
 */
export const TUI_SHORTCUTS: readonly {
  readonly keys: string
  readonly summary: string
}[] = [
  { keys: 'esc', summary: '中断任务；输入非空时先清空输入框' },
  { keys: 'Shift+Tab', summary: '循环权限策略(默认→编辑自动→计划；绕过走 /perm)' },
  { keys: 'Ctrl+O', summary: '显示/隐藏实时思考流' },
  { keys: 'Ctrl+U', summary: '清空整行输入' },
  { keys: 'Ctrl+W', summary: '删除光标前一个词' },
  { keys: '\\ + Enter', summary: '强制换行' },
  { keys: 'Shift+Enter', summary: '换行' },
  { keys: '↑/↓', summary: '翻阅历史输入(输入为空时)' },
  { keys: 'Tab', summary: '补全斜杠命令' },
  { keys: 'Ctrl+C×2', summary: '退出' },
]

export function helpLine(): string {
  return SLASH_COMMANDS.map((command) => command.name).join(' ')
}

export function helpDetail(): string {
  const commands = SLASH_COMMANDS.map(
    (command) => `${command.name} ${command.summary}`,
  ).join(' · ')
  const shortcuts = TUI_SHORTCUTS.map((shortcut) => `${shortcut.keys} ${shortcut.summary}`).join(
    ' · ',
  )
  return [`命令：${commands}`, `快捷键：${shortcuts}`].join('\n')
}

/** Ordered cycle for the `/effort` command; 'auto' = protocol default. */
export function effortLabel(effort: ReasoningEffort | undefined): string {
  return effort ?? 'auto'
}
