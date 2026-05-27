/**
 * Types for Claude Agent SDK (@anthropic-ai/claude-agent-sdk) integration.
 *
 * These mirror the SDK's public API surface so we can type-check our executor
 * without hard-coupling to the SDK package at compile time.
 * When the SDK is not installed the runtime fails fast with SDK_REQUIRED.
 *
 * Source: https://code.claude.com/docs/en/agent-sdk/typescript
 * Package: @anthropic-ai/claude-agent-sdk ^0.3.152
 */

// ── SDK Message Types ───────────────────────────────────────────────────────

export interface SDKAssistantMessage {
  type: 'assistant'
  uuid: string
  session_id: string
  message: {
    role: 'assistant'
    content: SDKContentBlock[]
    model?: string
    usage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
  }
  parent_tool_use_id: string | null
  error?: string
}

export interface SDKResultMessage {
  type: 'result'
  subtype: 'success' | 'error_max_turns' | 'error_during_execution' | 'error_max_budget_usd'
  uuid: string
  session_id: string
  duration_ms: number
  duration_api_ms: number
  is_error: boolean
  num_turns: number
  result?: string
  total_cost_usd: number
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
  }
  modelUsage?: Record<string, {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    costUSD: number
  }>
  errors?: string[]
  checkpoint?: SDKCheckpointInfo
}

export interface SDKCheckpointInfo {
  id?: string
  checkpoint_id?: string
  path?: string
  label?: string
  file_paths?: string[]
  files?: string[]
}

export interface SDKSystemMessage {
  type: 'system'
  subtype: 'init'
  uuid: string
  session_id: string
  tools: string[]
  model: string
  permissionMode: string
  mcp_servers: Array<{ name: string; status: string }>
  cwd: string
  skills: string[]
}

export interface SDKStreamEvent {
  type: 'stream_event'
  event: {
    type: string
    delta?: { type: string; text?: string; thinking?: string; partial_json?: string }
    content_block?: { type: string; id?: string; name?: string; text?: string; thinking?: string }
    index?: number
    message?: { usage?: { input_tokens: number; output_tokens: number } }
    usage?: { output_tokens: number }
  }
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
}

export interface SDKUserMessage {
  type: 'user'
  uuid: string
  session_id: string
  message: {
    role: 'user'
    content: string | SDKContentBlock[]
  }
}

export type SDKContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string | SDKContentBlock[]; is_error?: boolean }
  | { type: 'thinking'; thinking: string }

export type SDKMessage =
  | SDKAssistantMessage
  | SDKResultMessage
  | SDKSystemMessage
  | SDKStreamEvent
  | SDKUserMessage
  | { type: string; [key: string]: unknown }

// ── SDK Query API ───────────────────────────────────────────────────────────

export interface SDKMcpServerConfig {
  type?: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

export type SDKPermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'plan'
  | 'dontAsk'
  | 'auto'

export type SDKEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface SDKQueryOptions {
  abortController?: AbortController | undefined
  cwd?: string | undefined
  env?: Record<string, string | undefined> | undefined
  model?: string | undefined
  effort?: SDKEffort | undefined
  permissionMode?: SDKPermissionMode | undefined
  allowedTools?: string[] | undefined
  disallowedTools?: string[] | undefined
  mcpServers?: Record<string, SDKMcpServerConfig> | undefined
  systemPrompt?: string | { type: 'preset'; preset: 'claude_code'; append?: string | undefined } | undefined
  maxTurns?: number | undefined
  maxBudgetUsd?: number | undefined
  sessionId?: string | undefined
  continue?: boolean | undefined
  includePartialMessages?: boolean | undefined
  enableFileCheckpointing?: boolean | undefined
  canUseTool?: ((
    toolName: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<{ behavior: 'allow' } | { behavior: 'deny'; message: string }>) | undefined
  agents?: Record<string, {
    description: string
    prompt: string
    tools?: string[] | undefined
    model?: string | undefined
    maxTurns?: number | undefined
  }> | undefined
}

/**
 * The Query object returned by the SDK's query() function.
 * It is an AsyncGenerator<SDKMessage> with additional control methods.
 */
export interface SDKQuery extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>
  close(): void
}

export interface SDKQueryFunction {
  (params: { prompt: string; options?: SDKQueryOptions }): SDKQuery
}

// ── Spark ↔ SDK Permission Mode Mapping ─────────────────────────────────────

export type SparkPermissionMode =
  | 'claude-ask'
  | 'claude-auto-edits'
  | 'claude-plan'
  | 'claude-auto'
  | 'claude-bypass'
  | 'codex-default'
  | 'codex-auto-review'
  | 'codex-full-access'

// ── Executor Configuration ──────────────────────────────────────────────────

export interface SDKExecutorConfig {
  apiKey: string
  model: string
  apiEndpoint?: string | undefined
  systemPrompt?: string | undefined
  skillSystemPrompt?: string | undefined
  permissionMode: SparkPermissionMode
  maxTurnCount?: number | undefined
  maxTokens?: number | undefined
  maxBudgetUsd?: number | undefined
  workspaceRootPath: string
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | undefined
  mcpServers?: Record<string, SDKMcpServerConfig> | undefined
  allowedTools?: string[] | undefined
  disallowedTools?: string[] | undefined
  enableCheckpoints?: boolean | undefined
  continueSession?: boolean | undefined
  approvalCallback?: ((sessionId: string, toolName: string, toolInput: Record<string, unknown>) => Promise<boolean>) | undefined
}
