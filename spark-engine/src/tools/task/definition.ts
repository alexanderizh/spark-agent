import type { ToolDefinition } from '../contract.js'

const toolName = { type: 'string', minLength: 1, maxLength: 128 } as const

/**
 * The task tool is intentionally explicit about its boundaries. A child is
 * read-only by default; mutation-capable tools must be named in
 * `allowed_tools` by the parent model.
 */
export const taskToolDefinition: ToolDefinition = {
  name: 'task',
  description:
    'Run a focused subagent in an isolated session. The child returns a concise result to this turn. By default it can only inspect the workspace; when provided, allowed_tools is the exact tool allowlist for the child.',
  inputSchema: {
    type: 'object',
    properties: {
      description: { type: 'string', minLength: 1, maxLength: 200 },
      prompt: { type: 'string', minLength: 1, maxLength: 100_000 },
      allowed_tools: {
        type: 'array',
        items: toolName,
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
      },
      max_steps: { type: 'integer', minimum: 1, maximum: 50 },
      max_tool_calls: { type: 'integer', minimum: 1, maximum: 200 },
      max_tokens: { type: 'integer', minimum: 256, maximum: 32_768 },
    },
    required: ['description', 'prompt'],
    additionalProperties: false,
  },
  readonly: false,
  permissionClass: 'external',
  approval: 'session',
  concurrency: 'parallel',
  timeoutMs: 10 * 60 * 1_000,
  interruptible: true,
  costClass: 'cpu',
}

export interface TaskToolArgs {
  readonly description: string
  readonly prompt: string
  readonly allowed_tools?: readonly string[]
  readonly max_steps?: number
  readonly max_tool_calls?: number
  readonly max_tokens?: number
}

export function taskArgs(value: unknown): TaskToolArgs {
  if (
    !isRecord(value) ||
    typeof value.description !== 'string' ||
    typeof value.prompt !== 'string'
  ) {
    throw new Error('Task arguments require string description and prompt')
  }
  if (value.allowed_tools !== undefined && !isStringArray(value.allowed_tools)) {
    throw new Error('Task allowed_tools must be an array of strings')
  }
  return {
    description: value.description,
    prompt: value.prompt,
    ...(value.allowed_tools === undefined ? {} : { allowed_tools: value.allowed_tools }),
    ...(typeof value.max_steps === 'number' ? { max_steps: value.max_steps } : {}),
    ...(typeof value.max_tool_calls === 'number' ? { max_tool_calls: value.max_tool_calls } : {}),
    ...(typeof value.max_tokens === 'number' ? { max_tokens: value.max_tokens } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}
