export type CodingAgentToolGroup =
  | '文件'
  | '搜索'
  | '执行'
  | '版本控制'
  | '协作'
  | '网络'
  | '扩展'
  | '诊断'
  | '浏览器'

export type CodingAgentTool = {
  name: string
  group: CodingAgentToolGroup
  status: 'built-in' | 'extension'
}

export const CODING_AGENT_TOOLS: CodingAgentTool[] = [
  { name: 'read_file', group: '文件', status: 'built-in' },
  { name: 'write_file', group: '文件', status: 'built-in' },
  { name: 'edit_file', group: '文件', status: 'built-in' },
  { name: 'multi_edit', group: '文件', status: 'built-in' },
  { name: 'apply_patch', group: '文件', status: 'built-in' },
  { name: 'list_directory', group: '搜索', status: 'built-in' },
  { name: 'search_files', group: '搜索', status: 'built-in' },
  { name: 'grep_files', group: '搜索', status: 'built-in' },
  { name: 'grep', group: '搜索', status: 'built-in' },
  { name: 'run_command', group: '执行', status: 'built-in' },
  { name: 'bash', group: '执行', status: 'built-in' },
  { name: 'monitor', group: '执行', status: 'built-in' },
  { name: 'git', group: '版本控制', status: 'built-in' },
  { name: 'todo_write', group: '协作', status: 'built-in' },
  { name: 'task_create', group: '协作', status: 'built-in' },
  { name: 'task_update', group: '协作', status: 'built-in' },
  { name: 'web_fetch', group: '网络', status: 'built-in' },
  { name: 'web_search', group: '网络', status: 'built-in' },
  { name: 'exit_plan_mode', group: '协作', status: 'built-in' },
  { name: 'mcp_tools', group: '扩展', status: 'extension' },
  { name: 'lsp_diagnostics', group: '诊断', status: 'extension' },
  { name: 'browser', group: '浏览器', status: 'extension' },
]
