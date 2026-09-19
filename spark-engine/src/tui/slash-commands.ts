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
  { name: '/perm', summary: '选择权限策略(手动审批/自动审批/完全访问)' },
  { name: '/effort', summary: '选择推理强度(low/medium/high/max/off，默认 high)' },
  { name: '/update', summary: '检查并安装新版本(--check 仅检查)' },
  { name: '/sessions', summary: '选择并切换到历史会话' },
  { name: '/compact', summary: '压缩上下文：把早期对话折叠为摘要' },
  { name: '/context', summary: '查看上下文构成与 token 去向' },
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
  { keys: 'Shift+Tab', summary: '循环权限策略(手动审批→自动审批；完全访问走 /perm)' },
  { keys: 'Ctrl+O', summary: '显示/隐藏实时思考流' },
  { keys: 'Ctrl+E', summary: '展开/折叠长粘贴文本' },
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

/** One /help row: a left label column plus the explanation shown next to it. */
export interface HelpEntry {
  readonly label: string
  readonly summary: string
}

/** Blank cell count between the padded label column and the summary column. */
const LABEL_GAP = 2

/** Two-space indent keeps the rows visually nested under the section title. */
const ROW_INDENT = '  '

/**
 * Renders one /help section: the title followed by one line per entry, with
 * every label padded to `labelWidth` so the summaries line up in a shared
 * column instead of the list collapsing into one wrapped paragraph.
 *
 * Labels are ASCII command names and key names, so `length` is their terminal
 * cell width; revisit this if a label ever carries wide (CJK/emoji) glyphs.
 */
export function formatHelpSection(
  title: string,
  entries: readonly HelpEntry[],
  labelWidth: number,
): readonly string[] {
  const rows = entries.map((entry) => {
    const label = entry.label.padEnd(labelWidth)
    return `${ROW_INDENT}${label}${' '.repeat(LABEL_GAP)}${entry.summary}`.trimEnd()
  })
  return [title, ...rows]
}

/** Widest label across a section set: the shared summary column starts after it. */
export function widestHelpLabel(entries: readonly HelpEntry[]): number {
  return entries.reduce((widest, entry) => Math.max(widest, entry.label.length), 0)
}

/**
 * /help body: commands and shortcuts as one entry per line, grouped into
 * labelled sections separated by a blank line. Custom commands from
 * `.spark/commands` are appended as their own section. All sections share one
 * label column and the same section layout as the builtin lists.
 */
export function helpDetail(custom: readonly HelpEntry[] = []): string {
  const commands = SLASH_COMMANDS.map((command) => ({
    label: command.name,
    summary: command.summary,
  }))
  const shortcuts = TUI_SHORTCUTS.map((shortcut) => ({
    label: shortcut.keys,
    summary: shortcut.summary,
  }))
  const width = widestHelpLabel([...commands, ...shortcuts, ...custom])
  const sections: readonly (readonly string[])[] = [
    formatHelpSection('命令：', commands, width),
    formatHelpSection('快捷键：', shortcuts, width),
    ...(custom.length === 0 ? [] : [formatHelpSection('自定义命令：', custom, width)]),
  ]
  return sections.map((section) => section.join('\n')).join('\n\n')
}
