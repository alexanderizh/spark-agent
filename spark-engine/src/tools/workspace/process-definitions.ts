import type { ToolDefinition } from '../contract.js'

const properties = {
  process_id: { type: 'string', minLength: 1, maxLength: 128 },
  cursor: { type: 'integer', minimum: 0 },
}
export const processToolDefinitions: readonly ToolDefinition[] = [
  {
    name: 'process_wait',
    description:
      'Read incremental output from a managed command in this turn. Pass next_cursor from the prior result to avoid duplicate output. Waits for new output or completion, up to wait_ms (default 1000, maximum 30000). Running is not completion. Drain has_more and observe a terminal status before finishing the task. Never restarts commands.',
    inputSchema: {
      type: 'object',
      properties: { ...properties, wait_ms: { type: 'integer', minimum: 0, maximum: 30000 } },
      required: ['process_id'],
      additionalProperties: false,
    },
    readonly: true,
    permissionClass: 'read',
    approval: 'never',
    concurrency: 'parallel',
    timeoutMs: 35_000,
    interruptible: true,
    costClass: 'io',
  },
  {
    name: 'process_cancel',
    description:
      'Cancel a managed command belonging to this turn and wait for process-group cleanup. Returns status and incremental output; drain has_more with process_wait. Cannot cancel another turn or session.',
    inputSchema: {
      type: 'object',
      properties,
      required: ['process_id'],
      additionalProperties: false,
    },
    readonly: false,
    permissionClass: 'command',
    approval: 'never',
    concurrency: 'exclusive',
    timeoutMs: 10_000,
    interruptible: true,
    costClass: 'io',
  },
]
