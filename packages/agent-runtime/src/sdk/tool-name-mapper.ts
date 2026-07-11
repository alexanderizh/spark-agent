const TOOL_NAME_MAPPING: Readonly<Record<string, string>> = {
  Read: 'read_file',
  Write: 'write_file',
  Edit: 'edit_file',
  MultiEdit: 'multi_edit',
  Bash: 'bash',
  Glob: 'search_files',
  Grep: 'grep',
  TodoRead: 'todo_read',
  TodoWrite: 'todo_write',
  WebFetch: 'web_fetch',
  WebSearch: 'web_search',
  Agent: 'subagent',
  ExitPlanMode: 'exit_plan_mode',
  EnterPlanMode: 'enter_plan_mode',
  AskUserQuestion: 'ask_user_question',
  TaskCreate: 'task_create',
  TaskUpdate: 'task_update',
  TaskGet: 'task_get',
  TaskList: 'task_list',
  TaskOutput: 'task_output',
  TaskStop: 'task_stop',
  ListMcpResources: 'list_mcp_resources',
  ReadMcpResource: 'read_mcp_resource',
  ReadMcpResourceDir: 'read_mcp_resource_dir',
  REPL: 'repl',
  Workflow: 'workflow',
  ScheduleWakeup: 'schedule_wakeup',
  RemoteTrigger: 'remote_trigger',
  Monitor: 'monitor',
  Artifact: 'artifact',
  PushNotification: 'push_notification',
  EnterWorktree: 'enter_worktree',
  ExitWorktree: 'exit_worktree',
  ClaudeDesign: 'claude_design',
  Projects: 'projects',
  ReportFindings: 'report_findings',
}

export function mapSDKToolName(sdkName: string): string {
  const mapped = TOOL_NAME_MAPPING[sdkName]
  if (mapped != null) return mapped
  if (sdkName.startsWith('Cron')) return pascalToSnakeCase(sdkName)
  return sdkName
}

function pascalToSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}
