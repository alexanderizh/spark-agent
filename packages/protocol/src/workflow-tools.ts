// 工作流节点「工具」选择器的目录 —— 与 Claude Agent SDK 内置工具名一一对应，
// 供前端 TagPicker 展示，也供后端 dispatch 执行路径直接用作 disallowedTools 白名单换算。
// 名称必须是 SDK 认可的真实内置工具名（大小写敏感），不要用自造的展示名——
// 之前 CODING_AGENT_TOOLS 用 read_file/write_file 这类名字，UI 能选但从未真正生效。
export type WorkflowToolGroup = '文件' | '搜索' | '执行' | '协作' | '网络'

export interface WorkflowRestrictableTool {
  name: string
  label: string
  group: WorkflowToolGroup
}

export const WORKFLOW_RESTRICTABLE_TOOLS: WorkflowRestrictableTool[] = [
  { name: 'Read', label: '读文件', group: '文件' },
  { name: 'Write', label: '写文件', group: '文件' },
  { name: 'Edit', label: '编辑文件', group: '文件' },
  { name: 'MultiEdit', label: '批量编辑', group: '文件' },
  { name: 'NotebookEdit', label: '编辑 Notebook', group: '文件' },
  { name: 'Grep', label: '内容搜索', group: '搜索' },
  { name: 'Glob', label: '文件名搜索', group: '搜索' },
  { name: 'Bash', label: '执行命令', group: '执行' },
  { name: 'TodoWrite', label: '待办清单', group: '协作' },
  { name: 'AskUserQuestion', label: '向用户提问', group: '协作' },
  { name: 'ExitPlanMode', label: '退出计划模式', group: '协作' },
  { name: 'WebFetch', label: '抓取网页', group: '网络' },
  { name: 'WebSearch', label: '联网搜索', group: '网络' },
]

export const WORKFLOW_RESTRICTABLE_TOOL_NAMES: string[] = WORKFLOW_RESTRICTABLE_TOOLS.map((tool) => tool.name)
