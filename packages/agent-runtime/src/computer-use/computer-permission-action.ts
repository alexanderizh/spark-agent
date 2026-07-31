const COMPUTER_TOOL_PREFIXES = ['mcp__spark_computer__', 'mcp:spark_computer:'] as const

const COMPUTER_TASK_ACTIONS: Readonly<Record<string, string>> = {
  get_capabilities: 'computer_observe',
  diagnose_native_host: 'computer_observe',
  get_status: 'computer_observe',
  wait_for_completion: 'computer_observe',
  capture_app_snapshot: 'computer_observe',
  start_task: 'computer_task_start',
  pause: 'computer_pause',
  resume: 'computer_resume',
  stop: 'computer_stop',
  takeover: 'computer_takeover',
  bind_target: 'computer_resume',
}

const LOW_LEVEL_ACTIONS = new Set([
  'observe',
  'invoke_element',
  'set_value',
  'select_text',
  'click',
  'move',
  'drag',
  'scroll',
  'keypress',
  'type_text',
  'wait_for',
  'focus_window',
  'execute_action',
])

export function resolveComputerPermissionAction(toolName: string): string | null {
  const prefix = COMPUTER_TOOL_PREFIXES.find((candidate) => toolName.startsWith(candidate))
  if (prefix == null) return null
  const actionName = toolName.slice(prefix.length)
  if (LOW_LEVEL_ACTIONS.has(actionName)) return 'computer_direct_action'
  return COMPUTER_TASK_ACTIONS[actionName] ?? 'computer_unknown'
}

export function isUnapprovableComputerAction(action: string): boolean {
  return action === 'computer_unknown' || action === 'computer_direct_action'
}

export function isComputerSafetyControl(action: string): boolean {
  return action === 'computer_pause' || action === 'computer_stop' || action === 'computer_takeover'
}
